/**
 * Cartão de benefícios (D65), Postgres real (PGlite): saldo por carteira derivado, créditos automáticos idempotentes
 * no último dia útil, gasto que trava no saldo e entra em Gasto Bruto/Mensal, nada disso mexe no saldo da conta,
 * e encerrar para os créditos sem apagar o histórico.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { getAccountBalance } from '@/db/queries/balance';
import {
  benefitCreditsTotal,
  getBenefitCard,
  listBenefitCards,
  listBenefitMovements,
} from '@/db/queries/benefits';
import { cashSummary, grossSpend, monthlySpend, total } from '@/db/queries/reports';
import { listEntries } from '@/db/queries/entries';
import { seed, seedConfigFromEnv } from '@/db/seed';
import {
  createBenefitCard,
  createBenefitSpend,
  deleteBenefitSpend,
  endBenefitCard,
  generateBenefitCredits,
  updateBenefitCard,
} from '@/server/benefits';
import type { ServiceCtx } from '@/server/context';
import { freshDb } from './helpers';

const TODAY = '2026-10-21';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let accountId: string;
let mercado: string;
let cardId: string;
let multi: string;
let refeicao: string;

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;
const at = (today: string): ServiceCtx => ({ ...ctx, today });

const wallets = async (today = TODAY) => {
  const c = (await getBenefitCard(db, cardId, today, `${today.slice(0, 7)}-01`))!;
  return Object.fromEntries(c.wallets.map((w) => [w.name, w]));
};

const spend = (walletId: string, amount: number, date = TODAY, description = 'Almoço', today = date) =>
  createBenefitSpend(at(today), {
    walletId,
    amount,
    description,
    categoryId: mercado,
    date,
    beneficiaryUserId: null,
    notes: null,
  });

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
      SEED_OPENING_BALANCE: '1.000,00',
      SEED_OPENING_BALANCE_DATE: '2026-09-01',
    }),
  );
  mercado = (await q<{ id: string }>(`select id from categories where name = 'Mercado'`))[0]!.id;
  accountId = (await q<{ id: string }>(`select id from bank_accounts`))[0]!.id;
  const userId = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId, today: TODAY };
  ({ id: cardId } = await createBenefitCard(ctx, {
    name: 'Multibenefícios Empresa',
    issuer: 'Empresa',
    last4: null,
    creditRule: 'LAST_BUSINESS_DAY',
    creditDay: null,
    startMonth: '2026-10-01',
    wallets: [
      { name: 'Multibenefícios', monthlyCredit: 150_000, openingBalance: 80_000 },
      { name: 'Refeição e alimentação', monthlyCredit: 70_400, openingBalance: 0 },
    ],
  }));
  const ws = await wallets();
  multi = ws['Multibenefícios']!.id;
  refeicao = ws['Refeição e alimentação']!.id;
});

describe('cadastro', () => {
  it('saldo inicial vira o saldo da carteira, sem mexer no saldo da conta nem nos relatórios', async () => {
    const ws = await wallets();
    expect(ws['Multibenefícios']!.balanceCents).toBe(80_000);
    expect(ws['Refeição e alimentação']!.balanceCents).toBe(0);
    expect(await getAccountBalance(db, accountId, '2100-01-01')).toBe(100_000);
    const summary = (await cashSummary(db, '2026-10-01', TODAY))!;
    expect(summary.incomeReceivedCents).toBe(0);
    expect(summary.balanceCents).toBe(100_000);
    // saldo inicial não é crédito do mês nem despesa
    expect(await benefitCreditsTotal(db, '2026-10-01', '2026-10-31')).toBe(0);
    expect(total(await grossSpend(db, '2026-10-01', '2026-10-31', 'category'))).toBe(0);
  });

  it('recusa começar num mês cujo crédito já caiu (o saldo atual já o inclui)', async () => {
    await expect(
      createBenefitCard(at('2026-10-31'), {
        name: 'Outro',
        issuer: null,
        last4: null,
        creditRule: 'LAST_BUSINESS_DAY',
        creditDay: null,
        startMonth: '2026-10-01',
        wallets: [{ name: 'Vale', monthlyCredit: 10_000, openingBalance: 0 }],
      }),
    ).rejects.toThrow('já caiu. Comece o crédito automático em novembro de 2026');
  });

  it('o evento fica no histórico de alterações', async () => {
    const r = await q(`select 1 from audit_log where entity = 'benefit_cards' and action = 'CREATE'`);
    expect(r).toHaveLength(1);
  });
});

describe('créditos automáticos (último dia útil)', () => {
  it('cai no último dia útil, uma vez só, e conta como receita fora do saldo da conta', async () => {
    expect(await generateBenefitCredits(db, '2026-10-29')).toBe(0); // ainda não: 31/10 é sábado → dia 30
    expect(await generateBenefitCredits(db, '2026-10-30')).toBe(2);
    expect(await generateBenefitCredits(db, '2026-10-30')).toBe(0); // idempotente
    expect(await generateBenefitCredits(db, '2026-10-31')).toBe(0);

    const ws = await wallets('2026-10-30');
    expect(ws['Multibenefícios']!.balanceCents).toBe(80_000 + 150_000);
    expect(ws['Refeição e alimentação']!.balanceCents).toBe(70_400);
    expect(ws['Multibenefícios']!.creditedInMonthCents).toBe(150_000);

    const [credit] = await q<{ posted: string; month: string; src: string }>(
      `select posted_date::text as posted, benefit_credit_month::text as month, source::text as src from transactions
       where benefit_wallet_id = $1 and benefit_credit_month is not null`,
      [multi],
    );
    expect(credit).toEqual({ posted: '2026-10-30', month: '2026-10-01', src: 'SYSTEM' });

    expect(await benefitCreditsTotal(db, '2026-10-01', '2026-10-31')).toBe(220_400);
    expect(await getAccountBalance(db, accountId, '2100-01-01')).toBe(100_000); // o dinheiro não passa pelo banco
    const summary = (await cashSummary(db, '2026-10-01', '2026-10-30'))!;
    expect(summary.incomeReceivedCents).toBe(0);
  });

  it('recupera meses perdidos se o worker ficou fora do ar', async () => {
    expect(await generateBenefitCredits(db, '2026-12-31')).toBe(6); // out, nov, dez × 2 carteiras
    const ws = await wallets('2026-12-31');
    expect(ws['Refeição e alimentação']!.balanceCents).toBe(3 * 70_400);
  });

  it('mudar o valor mensal vale só para os créditos que ainda não caíram', async () => {
    await generateBenefitCredits(db, '2026-10-30');
    await updateBenefitCard(ctx, cardId, {
      name: 'Multibenefícios Empresa',
      issuer: 'Empresa',
      last4: null,
      creditRule: 'LAST_BUSINESS_DAY',
      creditDay: null,
      wallets: [{ id: multi, monthlyCredit: 200_000 }],
    });
    await generateBenefitCredits(db, '2026-11-30');
    const rows = await q<{ m: string; a: string }>(
      `select benefit_credit_month::text m, amount_cents::text a from transactions
       where benefit_wallet_id = $1 and benefit_credit_month is not null order by 1`,
      [multi],
    );
    expect(rows).toEqual([
      { m: '2026-10-01', a: '150000' },
      { m: '2026-11-01', a: '200000' },
    ]);
  });
});

describe('gastos', () => {
  beforeEach(async () => {
    await generateBenefitCredits(db, '2026-10-30');
  });

  it('saem do saldo da carteira, entram em Gasto Bruto e Mensal e não mexem na conta', async () => {
    await spend(refeicao, 4_500, '2026-10-30');
    const ws = await wallets('2026-10-30');
    expect(ws['Refeição e alimentação']!.balanceCents).toBe(70_400 - 4_500);
    expect(ws['Refeição e alimentação']!.spentInMonthCents).toBe(4_500);

    const [bruto, mensal] = await Promise.all([
      grossSpend(db, '2026-10-01', '2026-10-31', 'category'),
      monthlySpend(db, '2026-10-01', '2026-10-31', 'category'),
    ]);
    expect(bruto.get(mercado)).toBe(4_500);
    expect(mensal.get(mercado)).toBe(4_500);

    expect(await getAccountBalance(db, accountId, '2100-01-01')).toBe(100_000);
    const summary = (await cashSummary(db, '2026-10-01', '2026-10-30'))!;
    expect(summary.outPaidCents).toBe(0); // não saiu da conta
    expect(await listEntries(db, { month: '2026-10-01' })).toHaveLength(0); // extrato é da conta
  });

  it('o filtro por meio de pagamento separa o cartão de benefícios do resto', async () => {
    await spend(multi, 3_000, '2026-10-30');
    const only = await grossSpend(db, '2026-10-01', '2026-10-31', 'category', {
      paymentMethod: 'BENEFIT_CARD',
    });
    expect(total(only)).toBe(3_000);
    expect(
      total(await grossSpend(db, '2026-10-01', '2026-10-31', 'category', { paymentMethod: 'PIX' })),
    ).toBe(0);
    expect(
      total(await monthlySpend(db, '2026-10-01', '2026-10-31', 'category', { paymentMethod: 'CREDIT_CARD' })),
    ).toBe(0);
  });

  it('cartão pré-pago não fica negativo: sem saldo, não lança (e nada é gravado)', async () => {
    await expect(spend(refeicao, 70_401)).rejects.toThrow('Saldo insuficiente em Refeição e alimentação');
    await spend(refeicao, 70_400); // exatamente o saldo pode
    await expect(spend(refeicao, 1)).rejects.toThrow('Saldo insuficiente');
    const ws = await wallets('2026-10-30');
    expect(ws['Refeição e alimentação']!.balanceCents).toBe(0);
  });

  it('data no futuro e anterior ao início do controle são recusadas', async () => {
    await expect(spend(multi, 100, '2026-10-22', 'Almoço', TODAY)).rejects.toThrow('futuro');
    await expect(spend(multi, 100, '2026-08-31', 'Almoço', TODAY)).rejects.toThrow();
  });

  it('excluir devolve o valor para a carteira e tira do relatório, sem apagar o registro', async () => {
    const { transactionId } = await spend(multi, 10_000, '2026-10-30');
    await deleteBenefitSpend(ctx, transactionId);
    const ws = await wallets('2026-10-30');
    expect(ws['Multibenefícios']!.balanceCents).toBe(80_000 + 150_000);
    expect(total(await grossSpend(db, '2026-10-01', '2026-10-31', 'category'))).toBe(0);
    const raw = await q<{ deleted: boolean }>(
      `select deleted_at is not null deleted from transactions where id = $1`,
      [transactionId],
    );
    expect(raw).toEqual([{ deleted: true }]);
    await expect(deleteBenefitSpend(ctx, transactionId)).rejects.toThrow('não encontrado');
  });

  it('não dá para excluir um crédito por aqui', async () => {
    const [credit] = await q<{ id: string }>(
      `select id from transactions where benefit_credit_month is not null limit 1`,
    );
    await expect(deleteBenefitSpend(ctx, credit!.id)).rejects.toThrow('não encontrado');
  });
});

describe('encerrar', () => {
  it('para os créditos a partir do mês seguinte e mantém histórico, saldo e gastos', async () => {
    await generateBenefitCredits(db, '2026-10-30');
    await spend(multi, 20_000, '2026-10-30');
    await endBenefitCard(ctx, cardId, '2026-10-01');

    expect(await generateBenefitCredits(db, '2026-12-31')).toBe(0); // nenhum crédito depois de outubro
    const view = (await listBenefitCards(db, '2026-12-31', '2026-12-01'))[0]!;
    expect(view.ended).toBe(true);
    expect(view.nextCreditDate).toBeNull();
    expect(view.wallets.find((w) => w.id === multi)!.balanceCents).toBe(80_000 + 150_000 - 20_000);

    // o saldo que sobrou ainda pode ser gasto
    await spend(multi, 5_000, '2026-12-15');
    const moves = await listBenefitMovements(db, cardId);
    expect(moves.map((m) => m.type).sort()).toEqual(['CREDIT', 'CREDIT', 'OPENING', 'SPEND', 'SPEND']);

    await expect(endBenefitCard(ctx, cardId, '2026-10-01')).rejects.toThrow('já está encerrado');
  });

  it('encerrar antes do primeiro crédito é recusado', async () => {
    await expect(endBenefitCard(ctx, cardId, '2026-09-01')).rejects.toThrow('antes do primeiro crédito');
  });

  it('cartão encerrado vai para o fim da lista', async () => {
    await createBenefitCard(ctx, {
      name: 'Outro cartão',
      issuer: null,
      last4: null,
      creditRule: 'DAY_OF_MONTH',
      creditDay: 5,
      startMonth: '2026-11-01',
      wallets: [{ name: 'Vale', monthlyCredit: 10_000, openingBalance: 0 }],
    });
    await endBenefitCard(ctx, cardId, '2026-10-01');
    const list = await listBenefitCards(db, '2026-12-15', '2026-12-01');
    expect(list.map((c) => [c.name, c.ended])).toEqual([
      ['Outro cartão', false],
      ['Multibenefícios Empresa', true],
    ]);
  });
});

describe('constraints do banco (última linha de defesa)', () => {
  it('gasto no cartão de benefícios sem carteira, ou na conta com carteira, é recusado', async () => {
    const user = ctx.userId;
    await expect(
      pg.query(
        `insert into transactions (kind, description, amount_cents, payment_method, category_id, transaction_date, posted_date, created_by_user_id)
         values ('EXPENSE','x',100,'BENEFIT_CARD',$1,'2026-10-21','2026-10-21',$2)`,
        [mercado, user],
      ),
    ).rejects.toThrow();
    await expect(
      pg.query(
        `insert into transactions (kind, description, amount_cents, payment_method, bank_account_id, benefit_wallet_id, category_id, transaction_date, posted_date, created_by_user_id)
         values ('EXPENSE','x',100,'PIX',$1,$2,$3,'2026-10-21','2026-10-21',$4)`,
        [accountId, multi, mercado, user],
      ),
    ).rejects.toThrow();
  });
});
