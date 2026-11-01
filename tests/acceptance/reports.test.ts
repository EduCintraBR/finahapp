/**
 * Fase 4 — fórmulas canônicas de produção (src/db/queries/reports.ts) contra referências SQL.
 * Cenário: compra 12x, parcelamento em andamento, antecipação avulsa, estorno, fixo pendente,
 * despesa e receita na conta.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import {
  anticipationSavings,
  cashSummary,
  grossSpend,
  monthlySpend,
  projection,
  total,
} from '@/db/queries/reports';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { createCardPurchase, createOnboardingPlan } from '@/server/card-purchases';
import { createCard } from '@/server/cards';
import type { ServiceCtx } from '@/server/context';
import { createEntry } from '@/server/entries';
import { anticipate, refundPurchase } from '@/server/invoice-ops';
import { createTemplate } from '@/server/recurring';
import { freshDb } from './helpers';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let card: string;
const cat: Record<string, string> = {};

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;

/** Referência copiada de tests/acceptance/card-ledger.test.ts. */
const refGross = async (month: string) =>
  Number(
    (
      await q<{ v: string }>(
        `select
          coalesce((select sum(amount_cents) from transactions
                    where kind = 'EXPENSE' and status <> 'CANCELLED' and deleted_at is null
                      and source <> 'ONBOARDING'
                      and date_trunc('month', transaction_date) = $1::date), 0)
        - coalesce((select sum(amount_cents) from refund_records
                    where date_trunc('month', refund_date) = $1::date), 0) as v`,
        [month],
      )
    )[0]!.v,
  );

/** Referência do Gasto Mensal escrita a partir do texto da fórmula (CLAUDE.md). */
const refMonthly = async (month: string) =>
  Number(
    (
      await q<{ v: string }>(
        `select
          coalesce((select sum(amount_cents) from transactions where kind = 'EXPENSE' and bank_account_id is not null
                    and status <> 'CANCELLED' and deleted_at is null
                    and date_trunc('month', coalesce(due_date, posted_date)) = $1::date), 0)
        + coalesce((select sum(i.amount_cents) from invoice_items i join invoices v on v.id = i.invoice_id
                    where i.status = 'ACTIVE' and date_trunc('month', v.due_date) = $1::date), 0)
        + coalesce((select sum(amount_cents) from transactions where kind = 'ANTICIPATION_PAYMENT'
                    and status = 'POSTED' and deleted_at is null and date_trunc('month', posted_date) = $1::date), 0) as v`,
        [month],
      )
    )[0]!.v,
  );

const month = (m: string) =>
  [m, `${m.slice(0, 8)}${new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()}`] as const;

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
      SEED_OPENING_BALANCE: '5.000,00',
      SEED_OPENING_BALANCE_DATE: '2026-10-01',
    }),
  );
  for (const r of await q<{ id: string; name: string }>(`select id, name from categories`))
    cat[r.name] = r.id;
  const eduardo = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId: eduardo, today: '2026-10-17' };
  card = (
    await createCard(ctx, {
      name: 'Nubank',
      issuer: null,
      last4: null,
      isAdditional: false,
      holderName: null,
      limitTotal: 1_000_000,
      closingDay: 3,
      dueDay: 10,
      botAliases: [],
    })
  ).id;

  const entry = { notes: null, beneficiaryUserId: null };
  await createEntry(ctx, {
    ...entry,
    kind: 'EXPENSE',
    amount: 10_000,
    description: 'Feira',
    categoryId: cat['Mercado']!,
    paymentMethod: 'PIX',
    date: '2026-10-05',
  });
  await createEntry(ctx, {
    ...entry,
    kind: 'INCOME',
    amount: 100_000,
    description: 'Freela',
    categoryId: cat['Renda extra']!,
    paymentMethod: 'PIX',
    date: '2026-10-06',
  });
  await createTemplate(ctx, {
    type: 'FIXED',
    direction: 'EXPENSE',
    description: 'Aluguel',
    categoryId: cat['Moradia']!,
    amount: 200_000,
    dayOfMonth: 10,
    paymentMethod: 'BOLETO',
    creditCardId: null,
    startMonth: '2026-10-01',
    endMonth: null,
    beneficiaryUserId: null,
  });
  const { planId } = await createCardPurchase(ctx, {
    cardId: card,
    amount: 120_000,
    installments: 12,
    description: 'TV',
    categoryId: cat['Mercado']!,
    date: '2026-10-16',
    beneficiaryUserId: null,
    notes: null,
  });
  await createOnboardingPlan(ctx, {
    cardId: card,
    description: 'Geladeira',
    total: 100_000,
    installments: 10,
    currentInstallment: 9,
    purchaseDate: '2026-02-05',
    currentInvoiceMonth: '2026-11-01',
    categoryId: cat['Casa e manutenção']!,
    beneficiaryUserId: null,
  });
  const p12 = (
    await q<{ id: string }>(
      `select id from invoice_items where installment_plan_id = $1 and installment_number = 12`,
      [planId],
    )
  )[0]!.id;
  await anticipate(ctx, planId, {
    itemIds: [p12],
    paid: 9_000,
    date: '2026-10-17',
    settlement: 'DIRECT_PAYMENT',
    targetInvoiceId: null,
  });
  const dec = (await q<{ id: string }>(`select id from invoices where reference_month = '2026-12-01'`))[0]!
    .id;
  await refundPurchase({ ...ctx, today: '2026-11-20' }, planId, {
    mode: 'CREDIT_KEEP_INSTALLMENTS',
    amount: 3_000,
    refundDate: '2026-11-20',
    targetInvoiceId: dec,
    reason: null,
  });
});

describe('Gasto Bruto (competência)', () => {
  it('igual à fórmula de referência, mês a mês', async () => {
    for (const m of ['2026-10-01', '2026-11-01', '2026-12-01', '2026-02-01']) {
      expect(total(await grossSpend(db, ...month(m), 'category'))).toBe(await refGross(m));
    }
    // compra cheia no mês da compra (+ fixo pendente + feira); onboarding fora; estorno abate novembro
    expect(total(await grossSpend(db, ...month('2026-10-01'), 'category'))).toBe(120_000 + 10_000 + 200_000);
    expect(total(await grossSpend(db, ...month('2026-11-01'), 'category'))).toBe(-3_000);
  });

  it('por categoria e com filtros', async () => {
    const oct = await grossSpend(db, ...month('2026-10-01'), 'category');
    expect(oct.get(cat['Mercado']!)).toBe(130_000);
    expect(oct.get(cat['Moradia']!)).toBe(200_000);
    expect(total(await grossSpend(db, ...month('2026-10-01'), 'category', { cardId: card }))).toBe(120_000);
    expect(total(await grossSpend(db, ...month('2026-10-01'), 'category', { paymentMethod: 'PIX' }))).toBe(
      10_000,
    );
    expect(
      total(await grossSpend(db, ...month('2026-10-01'), 'category', { categoryId: cat['Moradia']! })),
    ).toBe(200_000);
  });
});

describe('Gasto Mensal (caixa)', () => {
  it('igual à fórmula, mês a mês; INVOICE_PAYMENT nunca entra', async () => {
    for (const m of ['2026-10-01', '2026-11-01', '2026-12-01', '2027-10-01']) {
      expect(total(await monthlySpend(db, ...month(m), 'category'))).toBe(await refMonthly(m));
    }
    expect(total(await monthlySpend(db, ...month('2026-10-01'), 'category'))).toBe(10_000 + 200_000 + 9_000);
    expect(total(await monthlySpend(db, ...month('2026-11-01'), 'category'))).toBe(10_000 + 10_000);
    expect(total(await monthlySpend(db, ...month('2026-12-01'), 'category'))).toBe(10_000 + 10_000 - 3_000);
    expect(total(await monthlySpend(db, ...month('2027-10-01'), 'category'))).toBe(0); // parcela 12 foi antecipada
  });

  it('por categoria, por mês e com filtros', async () => {
    const dec = await monthlySpend(db, ...month('2026-12-01'), 'category');
    expect(dec.get(cat['Mercado']!)).toBe(7_000);
    expect(dec.get(cat['Casa e manutenção']!)).toBe(10_000);
    const byMonth = await monthlySpend(db, '2026-10-01', '2026-12-31', 'month');
    expect(Object.fromEntries(byMonth)).toEqual({
      '2026-10-01': 219_000,
      '2026-11-01': 20_000,
      '2026-12-01': 17_000,
    });
    expect(total(await monthlySpend(db, ...month('2026-11-01'), 'category', { paymentMethod: 'PIX' }))).toBe(
      0,
    );
    expect(total(await monthlySpend(db, ...month('2026-10-01'), 'category', { cardId: card }))).toBe(9_000);
  });

  it('economia com antecipação', async () => {
    expect(await anticipationSavings(db, ...month('2026-10-01'))).toBe(1_000);
  });
});

describe('Home: resumo de caixa (D38) e projeção (D39–D41)', () => {
  it('saldo, receitas, saídas e saldo projetado do mês atual', async () => {
    const s = await cashSummary(db, '2026-10-01', '2026-10-17');
    expect(s).toEqual({
      balanceCents: 500_000 + 100_000 - 10_000 - 9_000,
      incomeReceivedCents: 100_000,
      incomePendingCents: 0,
      outPaidCents: 10_000 + 9_000,
      outPendingCents: 200_000,
      outTotalCents: 10_000 + 9_000 + 200_000, // Saídas (U4): saiu + a pagar
      endOfMonthCents: 581_000 - 200_000,
      endOfMonthKind: 'projected',
    });
  });

  it('projeção dos meses seguintes com saldo acumulado', async () => {
    const p = await projection(db, '2026-10-17', '2026-12-01');
    expect(
      p.map((r) => [r.month, r.fixedCents, r.invoicesCents, r.resultCents, r.estimatedBalanceCents]),
    ).toEqual([
      ['2026-11-01', 200_000, 20_000, -220_000, 381_000 - 220_000],
      ['2026-12-01', 200_000, 17_000, -217_000, 381_000 - 220_000 - 217_000],
    ]);
    const dec = await cashSummary(db, '2026-12-01', '2026-10-17');
    expect(dec).toMatchObject({ endOfMonthKind: 'estimated', endOfMonthCents: 381_000 - 437_000 });
  });
});
