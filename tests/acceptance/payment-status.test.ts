/**
 * Situação do pagamento e aporte (D69), Postgres real (PGlite):
 *  - despesa lançada no app pode ficar "a pagar" (vencida se a data passou) até a baixa; receita é sempre recebida;
 *  - sem saldo na conta, pagar exige um aporte com observação (entra no saldo, fora das receitas);
 *  - conta paga com a carteira do cartão de benefícios sai dela, não da conta.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { getAccountBalance } from '@/db/queries/balance';
import { getLoan } from '@/db/queries/loans';
import { cashSummary, grossSpend, monthlySpend, total } from '@/db/queries/reports';
import { summaryDetail } from '@/db/queries/summary-detail';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { createBenefitCard, deleteBenefitSpend } from '@/server/benefits';
import { createCardPurchase } from '@/server/card-purchases';
import { createCard } from '@/server/cards';
import { runAction, UserError, type ServiceCtx } from '@/server/context';
import { confirmPayment, createEntry, removeEntry, revertPayment } from '@/server/entries';
import { payInvoice } from '@/server/invoice-ops';
import { createLoan, payLoanInstallments } from '@/server/loans';
import { createTemplate, generateOccurrences } from '@/server/recurring';
import type { EntryInput } from '@/server/schemas';
import { freshDb } from './helpers';

const TODAY = '2026-10-24';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let accountId: string;
let mercado: string;
let contas: string;
let salario: string;

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;
const balance = (asOf = TODAY) => getAccountBalance(db, accountId, asOf);

const expense = (over: Partial<EntryInput> = {}): EntryInput => ({
  kind: 'EXPENSE',
  amount: 30_000,
  description: 'Cemig',
  categoryId: contas,
  paymentMethod: 'BOLETO',
  date: '2026-10-17',
  beneficiaryUserId: null,
  notes: null,
  ...over,
});

const row = async (id: string) =>
  (
    await q<{
      status: string;
      due: string | null;
      posted: string | null;
      amount: string;
      wallet: string | null;
      bank: string | null;
      method: string;
      version: number;
    }>(
      `select status, due_date::text as due, posted_date::text as posted, amount_cents::text as amount,
              benefit_wallet_id as wallet, bank_account_id as bank, payment_method::text as method, version
       from transactions where id = $1`,
      [id],
    )
  )[0]!;

beforeEach(async () => {
  ({ pg, db } = await freshDb());
  await seed(
    db,
    seedConfigFromEnv({
      SEED_USER1_NAME: 'Eduardo',
      SEED_USER1_EMAIL: 'eduardo@example.com',
      SEED_USER1_PASSWORD: 'senha-do-eduardo',
      SEED_USER2_NAME: 'Viviane',
      SEED_USER2_EMAIL: 'viviane@example.com',
      SEED_USER2_PASSWORD: 'senha-da-viviane',
      SEED_OPENING_BALANCE: '500,00', // saldo curto de propósito: R$ 500,00
      SEED_OPENING_BALANCE_DATE: '2026-10-01',
    }),
  );
  accountId = (await q<{ id: string }>(`select id from bank_accounts`))[0]!.id;
  mercado = (await q<{ id: string }>(`select id from categories where name = 'Mercado'`))[0]!.id;
  contas = (await q<{ id: string }>(`select id from categories where name = 'Contas da casa'`))[0]!.id;
  salario = (await q<{ id: string }>(`select id from categories where name = 'Salário CLT'`))[0]!.id;
  const eduardo = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId: eduardo, today: TODAY };
});

describe('lançar despesa: a pagar ou já paga', () => {
  it('sem "já paguei": nasce a pagar no dia informado, vencida se já passou, e não mexe no saldo', async () => {
    const { id } = await createEntry(ctx, expense({ paid: false })); // Cemig, venceu em 17/10
    expect(await row(id)).toMatchObject({
      status: 'PENDING',
      due: '2026-10-17',
      posted: null,
      amount: '30000',
    });
    expect(await balance()).toBe(50_000); // continua tudo na conta

    const s = (await cashSummary(db, '2026-10-01', TODAY))!;
    expect(s.outPaidCents).toBe(0);
    expect(s.outPendingCents).toBe(30_000); // aparece em "A pagar"
    const d = await summaryDetail(db, 'a-pagar', '2026-10-01', TODAY);
    expect(d.entries.map((e) => e.description)).toEqual(['Cemig']);
    expect(d.totalCents).toBe(s.outPendingCents);
  });

  it('com "já paguei": sai do saldo na hora (como antes)', async () => {
    const { id } = await createEntry(ctx, expense({ paid: true, amount: 20_000 }));
    expect(await row(id)).toMatchObject({ status: 'POSTED', due: null, posted: '2026-10-17' });
    expect(await balance()).toBe(30_000);
  });

  it('sem informar a chave (bot, importação): continua já pago, sem exigir aporte', async () => {
    const { id } = await createEntry(ctx, expense({ amount: 90_000 }), 'BOT'); // maior que o saldo
    expect((await row(id)).status).toBe('POSTED');
    expect(await balance()).toBe(50_000 - 90_000);
  });

  it('receita é sempre recebida, mesmo com paid=false', async () => {
    const { id } = await createEntry(
      ctx,
      expense({ kind: 'INCOME', categoryId: salario, description: 'Freela', paid: false, amount: 10_000 }),
    );
    expect((await row(id)).status).toBe('POSTED');
    expect(await balance()).toBe(60_000);
  });

  it('marcar como a pagar uma despesa que nasceu paga: volta a pendente no dia em que foi lançada', async () => {
    const { id } = await createEntry(ctx, expense({ paid: true, amount: 20_000 }));
    expect(await balance()).toBe(30_000);
    const v = (await row(id)).version;
    await revertPayment(ctx, id, v);
    expect(await row(id)).toMatchObject({
      status: 'PENDING',
      due: '2026-10-17',
      posted: null,
      amount: '20000',
    });
    expect(await balance()).toBe(50_000);
  });

  it('não dá para marcar como a pagar uma receita nem uma conta importada', async () => {
    const { id: inc } = await createEntry(
      ctx,
      expense({ kind: 'INCOME', categoryId: salario, amount: 5_000 }),
    );
    await expect(revertPayment(ctx, inc, (await row(inc)).version)).rejects.toThrow('despesa lançada no app');
    const { id: imp } = await createEntry(ctx, expense({ amount: 1_000 }), 'MANUAL');
    await q(`update transactions set source = 'IMPORT' where id = $1`, [imp]);
    await expect(revertPayment(ctx, imp, (await row(imp)).version)).rejects.toThrow('despesa lançada no app');
  });
});

describe('aporte quando a conta não tem saldo (D69)', () => {
  const pending = async (amount = 80_000) => (await createEntry(ctx, expense({ amount, paid: false }))).id;
  const pay = async (id: string, extra: Record<string, unknown> = {}, amount = 80_000, date = TODAY) =>
    confirmPayment(ctx, id, (await row(id)).version, { amount, date, ...extra });

  it('saldo basta: paga sem aporte', async () => {
    const id = await pending(30_000);
    await pay(id, {}, 30_000);
    expect(await balance()).toBe(20_000);
    expect(await q(`select 1 from transactions where funding_for_transaction_id is not null`)).toHaveLength(
      0,
    );
  });

  it('falta saldo: exige o aporte, dizendo quanto falta (R$ 800 − R$ 500 = R$ 300)', async () => {
    const id = await pending();
    const r = await runAction(() => pay(id));
    expect(r).toMatchObject({ ok: false, details: { fundingShortCents: 30_000 } });
    expect(!r.ok && r.error).toContain('faltam R$');
    expect((await row(id)).status).toBe('PENDING'); // nada foi gravado
    expect(await balance()).toBe(50_000);
  });

  it('aporte menor que o que falta ou sem observação é recusado', async () => {
    const id = await pending();
    await expect(pay(id, { fundingAmount: 29_999, fundingNote: 'poupança' })).rejects.toThrow('pelo menos');
    await expect(pay(id, { fundingAmount: 30_000 })).rejects.toThrow('Explique de onde veio');
    await expect(pay(id, { fundingAmount: 30_000, fundingNote: ' ab ' })).rejects.toThrow(
      'Explique de onde veio',
    );
    expect((await row(id)).status).toBe('PENDING');
  });

  it('aporte certo: vira uma entrada com a observação, ligada à conta, e o saldo fecha em zero', async () => {
    const id = await pending();
    await pay(id, { fundingAmount: 30_000, fundingNote: 'Cobri com a poupança' });
    expect((await row(id)).status).toBe('POSTED');
    const [f] = await q<{
      kind: string;
      amount: string;
      notes: string;
      date: string;
      forId: string;
      cat: string;
      status: string;
    }>(
      `select t.kind, t.amount_cents::text as amount, t.notes, t.posted_date::text as date,
              t.funding_for_transaction_id as "forId", c.name as cat, t.status
       from transactions t join categories c on c.id = t.category_id
       where t.funding_for_transaction_id is not null`,
    );
    expect(f).toEqual({
      kind: 'INCOME',
      amount: '30000',
      notes: 'Cobri com a poupança',
      date: TODAY,
      forId: id,
      cat: 'Aporte',
      status: 'POSTED',
    });
    expect(await balance()).toBe(0); // 500 + 300 − 800
  });

  it('aporte maior que o mínimo também vale (sobra no saldo)', async () => {
    const id = await pending();
    await pay(id, { fundingAmount: 50_000, fundingNote: 'Pix da mãe' });
    expect(await balance()).toBe(20_000);
  });

  it('o aporte entra no saldo, mas fica fora de "Entrou" e das receitas', async () => {
    const id = await pending();
    await pay(id, { fundingAmount: 30_000, fundingNote: 'Poupança' });
    const s = (await cashSummary(db, '2026-10-01', TODAY))!;
    expect(s.incomeReceivedCents).toBe(0);
    expect(s.balanceCents).toBe(0);
    const entrou = await summaryDetail(db, 'entrou', '2026-10-01', TODAY);
    expect(entrou.entries).toHaveLength(0);
    expect(entrou.totalCents).toBe(s.incomeReceivedCents);
    // mas a despesa conta normalmente
    expect(total(await grossSpend(db, '2026-10-01', '2026-10-31', 'category'))).toBe(80_000);
  });

  it('já pago pelo formulário, sem saldo: também exige o aporte', async () => {
    await expect(createEntry(ctx, expense({ paid: true, amount: 80_000 }))).rejects.toThrow('faltam');
    const { id } = await createEntry(
      ctx,
      expense({ paid: true, amount: 80_000, fundingAmount: 30_000, fundingNote: 'Poupança' }),
    );
    expect((await row(id)).status).toBe('POSTED');
    expect(await balance()).toBe(0);
  });

  it('o saldo é o da DATA do pagamento: um agendamento anterior conta, um posterior não', async () => {
    await createEntry(ctx, expense({ paid: true, amount: 40_000, date: '2026-10-20', description: 'Antes' }));
    const id = await pending(30_000);
    // em 24/10 o saldo é 100 (500 − 400): faltam 200 para pagar 300
    const r = await runAction(() => pay(id, {}, 30_000));
    expect(r).toMatchObject({ ok: false, details: { fundingShortCents: 20_000 } });
  });

  it('pagar fatura sem saldo exige o aporte', async () => {
    const card = await createCard(ctx, {
      name: 'Cartão A',
      issuer: null,
      last4: null,
      isAdditional: false,
      holderName: null,
      limitTotal: 500_000,
      closingDay: 9,
      dueDay: 16,
      botAliases: [],
    });
    const { invoiceId } = await createCardPurchase(ctx, {
      cardId: card.id,
      amount: 90_000,
      installments: 1,
      description: 'Compra',
      categoryId: mercado,
      date: '2026-10-05',
      beneficiaryUserId: null,
      notes: null,
    });
    const input = { amount: 90_000, date: TODAY, paymentMethod: 'PIX' as const };
    await expect(payInvoice(ctx, invoiceId, input)).rejects.toThrow('faltam');
    await payInvoice(ctx, invoiceId, { ...input, fundingAmount: 40_000, fundingNote: 'Venda do notebook' });
    expect(await balance()).toBe(0);
  });

  it('pagar parcela de empréstimo sem saldo exige o aporte', async () => {
    const { id } = await createLoan(ctx, {
      name: 'Empréstimo',
      lender: null,
      principal: 120_000,
      total: 120_000,
      installments: 2,
      receivedDate: '2026-10-10',
      firstDueDate: '2026-11-10',
      notes: null,
    });
    // o empréstimo entrou no saldo: 500 + 1.200 = 1.700; pagar as duas (R$ 1.200) não falta
    const loan = (await getLoan(db, id, TODAY))!;
    const ids = loan.installments.map((i) => i.id);
    await payLoanInstallments(ctx, id, { installmentIds: ids, paid: 120_000, date: TODAY });
    expect(await balance()).toBe(50_000);
    // com outro empréstimo cujo pagamento ultrapassa o saldo
    const { id: id2 } = await createLoan(ctx, {
      name: 'Outro',
      lender: null,
      principal: 10_000,
      total: 200_000,
      installments: 1,
      receivedDate: '2026-10-11',
      firstDueDate: '2026-11-10',
      notes: null,
    });
    const l2 = (await getLoan(db, id2, TODAY))!;
    const input = { installmentIds: [l2.installments[0]!.id], paid: 200_000, date: TODAY };
    await expect(payLoanInstallments(ctx, id2, input)).rejects.toThrow('faltam');
    await payLoanInstallments(ctx, id2, { ...input, fundingAmount: 140_000, fundingNote: 'Bônus' });
    expect(await balance()).toBe(0); // 500 + 100 recebidos + 1.400 de aporte − 2.000 pagos
  });
});

describe('pagar a conta com a carteira do cartão de benefícios (D69)', () => {
  let walletId: string;
  const benefit = async (opening: number) => {
    const { id } = await createBenefitCard(ctx, {
      name: 'Multibenefícios',
      issuer: null,
      last4: null,
      creditRule: 'LAST_BUSINESS_DAY',
      creditDay: null,
      startMonth: '2026-11-01',
      wallets: [{ name: 'Multibenefícios', monthlyCredit: 150_000, openingBalance: opening }],
    });
    void id;
    return (await q<{ id: string }>(`select id from benefit_wallets limit 1`))[0]!.id;
  };
  const wallet = async () =>
    Number(
      (
        await q<{ v: string }>(
          `select coalesce(sum(case when kind='INCOME' then amount_cents else -amount_cents end),0) as v
           from transactions where benefit_wallet_id = $1 and status = 'POSTED' and deleted_at is null`,
          [walletId],
        )
      )[0]!.v,
    );

  beforeEach(async () => {
    // início do crédito em novembro: o crédito de outubro (dia 30) ainda não caiu, então o saldo de hoje é o informado
    walletId = await benefit(150_000);
  });

  it('a carteira paga a conta inteira: sai dela e a conta bancária não muda', async () => {
    const { id } = await createEntry(ctx, expense({ description: 'Internet', amount: 12_000, paid: false }));
    await confirmPayment(ctx, id, (await row(id)).version, { amount: 12_000, date: TODAY, walletId });
    expect(await row(id)).toMatchObject({
      status: 'POSTED',
      bank: null,
      wallet: walletId,
      method: 'BENEFIT_CARD',
      posted: TODAY,
    });
    expect(await wallet()).toBe(150_000 - 12_000);
    expect(await balance()).toBe(50_000); // a conta não foi tocada
    expect(await q(`select 1 from transactions where funding_for_transaction_id is not null`)).toHaveLength(
      0,
    );
  });

  it('vira gasto normal nos relatórios (uma vez só) e sai de "A pagar"', async () => {
    const { id } = await createEntry(ctx, expense({ description: 'Internet', amount: 12_000, paid: false }));
    const before = (await cashSummary(db, '2026-10-01', TODAY))!;
    expect(before.outPendingCents).toBe(12_000);
    await confirmPayment(ctx, id, (await row(id)).version, { amount: 12_000, date: TODAY, walletId });
    const after = (await cashSummary(db, '2026-10-01', TODAY))!;
    expect(after.outPendingCents).toBe(0);
    expect(after.outPaidCents).toBe(0); // não saiu da conta
    expect(total(await grossSpend(db, '2026-10-01', '2026-10-31', 'category'))).toBe(12_000);
    expect(total(await monthlySpend(db, '2026-10-01', '2026-10-31', 'category'))).toBe(12_000);
  });

  it('valor menor ou maior que o estimado vale o que foi pago, e o estimado fica guardado', async () => {
    const { id } = await createEntry(ctx, expense({ description: 'Energia', amount: 20_000, paid: false }));
    await confirmPayment(ctx, id, (await row(id)).version, { amount: 18_500, date: TODAY, walletId });
    expect(await wallet()).toBe(150_000 - 18_500);
    expect(
      (
        await q<{ e: string }>(`select estimated_amount_cents::text as e from transactions where id = $1`, [
          id,
        ])
      )[0]!.e,
    ).toBe('20000');
  });

  it('carteira sem saldo para a conta toda: avisa e não paga (a conta continua pendente)', async () => {
    const { id } = await createEntry(ctx, expense({ amount: 160_000, paid: false }));
    await expect(
      confirmPayment(ctx, id, (await row(id)).version, { amount: 160_000, date: TODAY, walletId }),
    ).rejects.toThrow('Saldo insuficiente em Multibenefícios');
    expect((await row(id)).status).toBe('PENDING');
    expect(await wallet()).toBe(150_000);
  });

  it('pagando com a carteira não pede aporte, mesmo que o saldo da conta seja curto', async () => {
    const { id } = await createEntry(ctx, expense({ amount: 80_000, paid: false })); // conta só tem R$ 500
    await confirmPayment(ctx, id, (await row(id)).version, { amount: 80_000, date: TODAY, walletId });
    expect((await row(id)).status).toBe('POSTED');
    expect(await balance()).toBe(50_000);
  });

  it('receita e parcela de empréstimo não são pagas com a carteira; data futura também não', async () => {
    const { id: loanId } = await createLoan(ctx, {
      name: 'Empréstimo',
      lender: null,
      principal: 30_000,
      total: 30_000,
      installments: 1,
      receivedDate: '2026-10-10',
      firstDueDate: '2026-10-25',
      notes: null,
    });
    const [inst] = await q<{ id: string; version: number }>(
      `select id, version from transactions where loan_id = $1 and loan_installment_number = 1`,
      [loanId],
    );
    await expect(
      confirmPayment(ctx, inst!.id, inst!.version, { amount: 30_000, date: TODAY, walletId }),
    ).rejects.toThrow('paga pela conta');
    const { id } = await createEntry(ctx, expense({ amount: 1_000, paid: false }));
    await expect(
      confirmPayment(ctx, id, (await row(id)).version, { amount: 1_000, date: '2026-10-30', walletId }),
    ).rejects.toThrow('não pode estar no futuro');
  });

  it('ocorrência de fixo paga com a carteira: excluir o gasto cancela e a geração não recria', async () => {
    await createTemplate(ctx, {
      type: 'FIXED',
      direction: 'EXPENSE',
      description: 'Internet fixa',
      categoryId: contas,
      amount: 10_000,
      dayOfMonth: 20,
      paymentMethod: 'BOLETO',
      creditCardId: null,
      startMonth: '2026-10-01',
      endMonth: null,
      beneficiaryUserId: null,
    });
    const [occ] = await q<{ id: string; version: number }>(
      `select id, version from transactions where recurring_template_id is not null`,
    );
    await confirmPayment(ctx, occ!.id, occ!.version, { amount: 10_000, date: TODAY, walletId });
    expect(await wallet()).toBe(140_000);
    await deleteBenefitSpend(ctx, occ!.id);
    expect(await wallet()).toBe(150_000);
    expect(await generateOccurrences(db, TODAY)).toBe(0); // não voltou como pendente
    expect((await row(occ!.id)).status).toBe('CANCELLED');
  });

  it('conta paga com a carteira não volta para "a pagar" por aqui (exclua e lance de novo)', async () => {
    const { id } = await createEntry(ctx, expense({ amount: 5_000, paid: false }));
    await confirmPayment(ctx, id, (await row(id)).version, { amount: 5_000, date: TODAY, walletId });
    await expect(revertPayment(ctx, id, (await row(id)).version)).rejects.toThrow('cartão de benefícios');
  });
});

describe('o resto do fluxo não mudou', () => {
  it('excluir uma conta a pagar não mexe no saldo', async () => {
    const { id } = await createEntry(ctx, expense({ paid: false }));
    await removeEntry(ctx, id, (await row(id)).version);
    expect(await balance()).toBe(50_000);
  });

  it('o UserError sem detalhes continua simples', () => {
    expect(new UserError('x').details).toBeUndefined();
  });
});
