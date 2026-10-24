/**
 * Cartão de benefícios (D65): cadastro, créditos automáticos, gastos e encerramento.
 * O saldo da carteira NUNCA é armazenado: é Σ INCOME POSTED − Σ EXPENSE POSTED da carteira
 * (ver walletBalances em db/queries/benefits.ts). Tudo que escreve em mais de uma tabela roda em transação.
 */
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { AnyDB } from '@/db/client';
import { benefitCards, benefitWallets, categories, transactions } from '@/db/schema';
import { checkNotBeforeOpening } from '@/domain/account/rules';
import {
  creditDateFor,
  dueCreditMonths,
  type CreditRule,
  type CreditSchedule,
} from '@/domain/benefits/credits';
import { addMonths, compareDates, formatMonthLabel, monthStart, type ISODate } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { audit } from './audit';
import { checkExpenseCategory, checkUser } from './card-purchases';
import { type ServiceCtx, type Tx, UserError } from './context';
import { getPrimaryAccount } from './entries';
import { walletBalance } from './wallet-balance';
import type { BenefitCardInput, BenefitCardUpdateInput, BenefitSpendInput } from './schemas';

export const BENEFIT_CATEGORY_NAME = 'Benefícios';

/** Categoria de receita dos créditos (criada na primeira vez; o seed de produção nunca é reexecutado). */
async function benefitCategoryId(tx: Tx): Promise<string> {
  const [found] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.name, BENEFIT_CATEGORY_NAME), eq(categories.kind, 'INCOME')));
  if (found) return found.id;
  const [row] = await tx
    .insert(categories)
    .values({ name: BENEFIT_CATEGORY_NAME, kind: 'INCOME', botAliases: [] })
    .returning({ id: categories.id });
  return row!.id;
}

const scheduleOf = (c: {
  creditRule: string;
  creditDay: number | null;
  startMonth: ISODate;
  endMonth: ISODate | null;
}): CreditSchedule => ({
  rule: c.creditRule as CreditRule,
  day: c.creditDay,
  startMonth: c.startMonth,
  endMonth: c.endMonth,
});

async function loadCard(tx: Tx, id: string) {
  const [c] = await tx.select().from(benefitCards).where(eq(benefitCards.id, id)).for('update');
  if (!c) throw new UserError('Cartão de benefícios não encontrado.');
  return c;
}

function creditSnapshot(
  ctx: { userId: string },
  wallet: { id: string; name: string },
  amount: number,
  date: ISODate,
  categoryId: string,
  extra: Partial<typeof transactions.$inferInsert>,
): typeof transactions.$inferInsert {
  return {
    kind: 'INCOME',
    status: 'POSTED',
    description: `Crédito ${wallet.name}`,
    amountCents: amount,
    paymentMethod: 'BENEFIT_CARD',
    benefitWalletId: wallet.id,
    categoryId,
    transactionDate: date,
    postedDate: date,
    createdByUserId: ctx.userId,
    source: 'SYSTEM',
    ...extra,
  };
}

/**
 * Cadastra o cartão e as carteiras. O saldo atual de cada carteira entra como saldo inicial (fora dos relatórios).
 * O primeiro crédito automático tem que ser de um mês que ainda não caiu: o que já caiu está no saldo atual.
 */
export async function createBenefitCard(ctx: ServiceCtx, input: BenefitCardInput): Promise<{ id: string }> {
  const schedule: CreditSchedule = {
    rule: input.creditRule,
    day: input.creditDay,
    startMonth: input.startMonth,
    endMonth: null,
  };
  const overdue = dueCreditMonths(schedule, ctx.today, []);
  if (overdue.length > 0) {
    let next = monthStart(ctx.today);
    while (compareDates(creditDateFor(schedule, next), ctx.today) <= 0) next = addMonths(next, 1);
    throw new UserError(
      `O crédito de ${formatMonthLabel(overdue[0]!)} já caiu. Comece o crédito automático em ${formatMonthLabel(next)} ` +
        'e informe em cada carteira o saldo que ela tem hoje.',
    );
  }
  return ctx.db.transaction(async (tx) => {
    const [card] = await tx
      .insert(benefitCards)
      .values({
        name: input.name,
        issuer: input.issuer,
        last4: input.last4,
        creditRule: input.creditRule,
        creditDay: input.creditDay,
        startMonth: input.startMonth,
        createdByUserId: ctx.userId,
      })
      .returning();
    const wallets = await tx
      .insert(benefitWallets)
      .values(
        input.wallets.map((w) => ({
          benefitCardId: card!.id,
          name: w.name,
          monthlyCreditCents: w.monthlyCredit,
        })),
      )
      .returning();
    const categoryId = await benefitCategoryId(tx);
    for (const w of wallets) {
      const opening = input.wallets.find((x) => x.name === w.name)!.openingBalance;
      if (opening > 0) {
        await tx.insert(transactions).values(
          creditSnapshot(ctx, w, opening, ctx.today, categoryId, {
            description: `Saldo inicial · ${w.name}`,
            source: 'ONBOARDING',
          }),
        );
      }
    }
    await audit(tx, {
      userId: ctx.userId,
      entity: 'benefit_cards',
      entityId: card!.id,
      action: 'CREATE',
      after: { card, wallets },
    });
    return { id: card!.id };
  });
}

/**
 * Corrige nome, regra/dia do crédito e o valor mensal de cada carteira. Vale para os créditos que ainda não
 * caíram; os que já foram creditados não mudam (são fatos).
 */
export async function updateBenefitCard(ctx: ServiceCtx, id: string, input: BenefitCardUpdateInput) {
  return ctx.db.transaction(async (tx) => {
    const before = await loadCard(tx, id);
    const wallets = await tx.select().from(benefitWallets).where(eq(benefitWallets.benefitCardId, id));
    const ids = new Set(wallets.map((w) => w.id));
    if (input.wallets.some((w) => !ids.has(w.id)))
      throw new UserError('Carteira não pertence a este cartão.');
    const [after] = await tx
      .update(benefitCards)
      .set({
        name: input.name,
        issuer: input.issuer,
        last4: input.last4,
        creditRule: input.creditRule,
        creditDay: input.creditRule === 'DAY_OF_MONTH' ? input.creditDay : null,
      })
      .where(eq(benefitCards.id, id))
      .returning();
    for (const w of input.wallets) {
      await tx
        .update(benefitWallets)
        .set({ monthlyCreditCents: w.monthlyCredit })
        .where(eq(benefitWallets.id, w.id));
    }
    await audit(tx, {
      userId: ctx.userId,
      entity: 'benefit_cards',
      entityId: id,
      action: 'UPDATE',
      before: { card: before, wallets },
      after: { card: after, wallets: input.wallets },
    });
  });
}

/**
 * Encerra o cartão: `lastMonth` é o último mês com crédito automático. Nada é apagado: o histórico, o saldo que
 * sobrou e os gastos continuam. Encerrar antes do início não faz sentido (use o mês do primeiro crédito).
 */
export async function endBenefitCard(ctx: ServiceCtx, id: string, lastMonth: ISODate) {
  return ctx.db.transaction(async (tx) => {
    const before = await loadCard(tx, id);
    if (before.endMonth) throw new UserError('Este cartão já está encerrado.');
    if (compareDates(lastMonth, before.startMonth) < 0) {
      throw new UserError(
        `O último mês não pode ser antes do primeiro crédito (${formatMonthLabel(before.startMonth)}).`,
      );
    }
    const [after] = await tx
      .update(benefitCards)
      .set({ endMonth: lastMonth })
      .where(eq(benefitCards.id, id))
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'benefit_cards',
      entityId: id,
      action: 'END',
      before,
      after,
    });
  });
}

/**
 * Gasto no cartão de benefícios: despesa normal (entra em Gasto Bruto e Mensal) que sai do saldo da carteira.
 * Cartão pré-pago não tem limite negativo: sem saldo, não lança.
 */
export async function createBenefitSpend(
  ctx: ServiceCtx,
  input: BenefitSpendInput,
): Promise<{ transactionId: string; cardId: string }> {
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ wallet: benefitWallets, card: benefitCards })
      .from(benefitWallets)
      .innerJoin(benefitCards, eq(benefitCards.id, benefitWallets.benefitCardId))
      .where(eq(benefitWallets.id, input.walletId))
      .for('update', { of: benefitWallets });
    if (!row) throw new UserError('Carteira não encontrada.');
    if (compareDates(input.date, ctx.today) > 0)
      throw new UserError('A data do gasto não pode estar no futuro.');
    const account = await getPrimaryAccount(tx);
    const dateError = checkNotBeforeOpening(input.date, account.openingBalanceDate);
    if (dateError) throw new UserError(dateError);
    await checkExpenseCategory(tx, input.categoryId);
    await checkUser(tx, input.beneficiaryUserId);
    const balance = await walletBalance(tx, row.wallet.id);
    if (input.amount > balance) {
      throw new UserError(
        `Saldo insuficiente em ${row.wallet.name}: tem ${formatBRL(balance)} e o gasto é de ${formatBRL(input.amount)}.`,
      );
    }
    const [t] = await tx
      .insert(transactions)
      .values({
        kind: 'EXPENSE',
        status: 'POSTED',
        description: input.description,
        notes: input.notes,
        amountCents: input.amount,
        paymentMethod: 'BENEFIT_CARD',
        benefitWalletId: row.wallet.id,
        categoryId: input.categoryId,
        transactionDate: input.date,
        postedDate: input.date,
        createdByUserId: ctx.userId,
        beneficiaryUserId: input.beneficiaryUserId,
        source: 'MANUAL',
      })
      .returning();
    await audit(tx, {
      userId: ctx.userId,
      entity: 'transactions',
      entityId: t!.id,
      action: 'CREATE',
      after: t,
    });
    return { transactionId: t!.id, cardId: row.card.id };
  });
}

/** Exclui um gasto do cartão de benefícios (delete lógico): o valor volta para o saldo da carteira. */
export async function deleteBenefitSpend(ctx: ServiceCtx, transactionId: string) {
  return ctx.db.transaction(async (tx) => {
    const [t] = await tx.select().from(transactions).where(eq(transactions.id, transactionId)).for('update');
    if (!t || t.deletedAt || !t.benefitWalletId || t.kind !== 'EXPENSE') {
      throw new UserError('Gasto não encontrado.');
    }
    // ocorrência de fixo paga com a carteira: cancela em vez de apagar, ou a geração do mês a recriaria como pendente
    const isOccurrence = t.recurringTemplateId !== null;
    await tx
      .update(transactions)
      .set(
        isOccurrence
          ? { status: 'CANCELLED', version: sql`${transactions.version} + 1` }
          : { deletedAt: new Date(), version: sql`${transactions.version} + 1` },
      )
      .where(eq(transactions.id, transactionId));
    await audit(tx, {
      userId: ctx.userId,
      entity: 'transactions',
      entityId: transactionId,
      action: isOccurrence ? 'CANCEL' : 'DELETE',
      before: t,
    });
  });
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/**
 * Credita o que já devia ter caído (idempotente: o índice único (carteira, mês) garante um crédito por mês, mesmo
 * com o worker e o app rodando juntos). Cartão encerrado só recebe até o último mês. Devolve quantos créditos fez.
 */
export async function generateBenefitCredits(db: AnyDB, today: ISODate): Promise<number> {
  const cards = await db.select().from(benefitCards);
  if (cards.length === 0) return 0;
  const wallets = await db
    .select()
    .from(benefitWallets)
    .where(
      inArray(
        benefitWallets.benefitCardId,
        cards.map((c) => c.id),
      ),
    )
    .orderBy(asc(benefitWallets.createdAt));
  const done = await db
    .select({ walletId: transactions.benefitWalletId, month: transactions.benefitCreditMonth })
    .from(transactions)
    .where(and(isNotNull(transactions.benefitCreditMonth), isNull(transactions.deletedAt)));
  let created = 0;
  for (const card of cards) {
    const schedule = scheduleOf(card);
    for (const wallet of wallets.filter((w) => w.benefitCardId === card.id)) {
      const doneMonths = done.filter((d) => d.walletId === wallet.id).map((d) => d.month!);
      for (const month of dueCreditMonths(schedule, today, doneMonths)) {
        try {
          await db.transaction(async (tx) => {
            const categoryId = await benefitCategoryId(tx);
            const date = creditDateFor(schedule, month);
            const [t] = await tx
              .insert(transactions)
              .values(
                creditSnapshot(
                  { userId: card.createdByUserId },
                  wallet,
                  wallet.monthlyCreditCents,
                  date,
                  categoryId,
                  {
                    benefitCreditMonth: month,
                  },
                ),
              )
              .returning({ id: transactions.id });
            await audit(tx, {
              userId: null,
              entity: 'transactions',
              entityId: t!.id,
              action: 'GENERATE',
              after: { benefitWalletId: wallet.id, month, amountCents: wallet.monthlyCreditCents },
            });
          });
          created++;
        } catch (err) {
          if (!isUniqueViolation(err)) throw err; // outro processo creditou no mesmo instante
        }
      }
    }
  }
  return created;
}
