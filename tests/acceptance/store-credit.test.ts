/**
 * Crediário (D73) pelos SERVIÇOS de produção, contra Postgres real (PGlite): ciclo da fatura (40 dias, fecha 7
 * antes), juros (original × total), limite, Gasto Bruto, Saídas do mês, antecipação e parcelamento em andamento.
 * Os números são conferidos com as fórmulas de referência de card-ledger.test.ts.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { getPlanDetail, listCardSummaries } from '@/db/queries/cards';
import { cashSummary } from '@/db/queries/reports';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { createCardPurchase, createOnboardingPlan, updateCardPurchase } from '@/server/card-purchases';
import { createCard, updateCard } from '@/server/cards';
import type { ServiceCtx } from '@/server/context';
import { anticipate, payInvoice } from '@/server/invoice-ops';
import { createTemplate } from '@/server/recurring';
import { cardInput, type CardInput, type CardPurchaseInput } from '@/server/schemas';
import { freshDb } from './helpers';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let shopee: string;
let mercado: string;

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;
const at = (today: string): ServiceCtx => ({ ...ctx, today });

// ─────────── fórmulas de referência (card-ledger.test.ts) ───────────
const availableLimit = async (cardId: string) => {
  const [r] = await q<{ v: string }>(
    `select c.limit_total_cents
      - coalesce((select sum(i.amount_cents) from invoice_items i
                  where i.credit_card_id = c.id and i.status = 'ACTIVE'), 0)
      + coalesce((select sum(t.amount_cents) from transactions t
                  join invoices v on v.id = t.paid_invoice_id
                  where v.credit_card_id = c.id and t.kind = 'INVOICE_PAYMENT'
                    and t.status = 'POSTED' and t.deleted_at is null), 0) as v
    from credit_cards c where c.id = $1`,
    [cardId],
  );
  return Number(r!.v);
};
const grossSpend = async (month: string) =>
  Number(
    (
      await q<{ v: string }>(
        `select coalesce(sum(amount_cents), 0) v from transactions
          where kind = 'EXPENSE' and status <> 'CANCELLED' and deleted_at is null and source <> 'ONBOARDING'
            and date_trunc('month', transaction_date) = $1::date`,
        [month],
      )
    )[0]!.v,
  );
const invoicesOf = (cardId: string) =>
  q<{ ref: string; closing: string; due: string; total: string; id: string }>(
    `select v.id, v.reference_month::text ref, v.closing_date::text closing, v.due_date::text due,
       coalesce((select sum(i.amount_cents) from invoice_items i
                 where i.invoice_id = v.id and i.status = 'ACTIVE'), 0)::text total
     from invoices v where v.credit_card_id = $1 order by v.reference_month`,
    [cardId],
  );
const dueDayOf = async (cardId: string) =>
  (await q<{ due_day: number }>(`select due_day from credit_cards where id = $1`, [cardId]))[0]!.due_day;

const storeCredit = (over: Partial<CardInput> = {}): CardInput => ({
  kind: 'STORE_CREDIT',
  name: 'Shopee Parcelado',
  issuer: null,
  last4: null,
  isAdditional: false,
  holderName: null,
  limitTotal: 65_000,
  firstDueDays: 40,
  closeBeforeDays: 7,
  botAliases: ['shopee'],
  ...over,
});
const purchase = (over: Partial<CardPurchaseInput> = {}): CardPurchaseInput => ({
  cardId: shopee,
  amount: 11_500,
  originalAmount: 10_000,
  installments: 3,
  description: 'Fone',
  categoryId: mercado,
  date: '2026-10-17',
  beneficiaryUserId: null,
  notes: null,
  ...over,
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
      SEED_OPENING_BALANCE: '5.000,00',
      SEED_OPENING_BALANCE_DATE: '2026-10-01',
    }),
  );
  mercado = (await q<{ id: string }>(`select id from categories where name = 'Mercado'`))[0]!.id;
  const eduardo = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId: eduardo, today: '2026-10-17' };
  shopee = (await createCard(ctx, storeCredit())).id;
});

describe('cadastro do crediário', () => {
  it('grava o tipo, o prazo e o fechamento, sem dia de fechamento fixo', async () => {
    const [c] = await q(
      `select kind, closing_day, first_due_days, close_before_days, limit_total_cents::int lim
       from credit_cards where id = $1`,
      [shopee],
    );
    expect(c).toEqual({
      kind: 'STORE_CREDIT',
      closing_day: null,
      first_due_days: 40,
      close_before_days: 7,
      lim: 65_000,
    });
    expect(await availableLimit(shopee)).toBe(65_000);
  });

  it('o formulário exige prazo e fechamento coerentes', () => {
    const base = { name: 'Carnê Magalu', kind: 'STORE_CREDIT', limitTotal: '1.000,00' };
    expect(cardInput.safeParse({ ...base, firstDueDays: '30', closeBeforeDays: '7' }).success).toBe(true);
    const bad = cardInput.safeParse({ ...base, firstDueDays: '10', closeBeforeDays: '10' });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues[0]!.message).toMatch(/fechar depois da compra/);
    expect(cardInput.safeParse({ ...base, closeBeforeDays: '7' }).error!.issues[0]!.message).toMatch(
      /prazo da 1ª fatura/,
    );
    // cartão continua exigindo os dias
    expect(cardInput.safeParse({ name: 'Itaú', dueDay: '10' }).error!.issues[0]!.message).toMatch(
      /fechamento/,
    );
  });

  it('não vira cartão na edição, e não aceita assinatura (fixo) nem no banco', async () => {
    await expect(
      updateCard(ctx, shopee, { ...storeCredit(), kind: 'CARD', closingDay: 3, dueDay: 10 }),
    ).rejects.toThrow(/Não dá para transformar/);
    await updateCard(ctx, shopee, storeCredit({ name: 'Shopee', firstDueDays: 30 }));
    expect((await q(`select name, first_due_days from credit_cards where id = $1`, [shopee]))[0]).toEqual({
      name: 'Shopee',
      first_due_days: 30,
    });
    await expect(
      createTemplate(ctx, {
        type: 'FIXED',
        direction: 'EXPENSE',
        description: 'Assinatura',
        categoryId: mercado,
        amount: 1_000,
        dayOfMonth: 20,
        paymentMethod: 'CREDIT_CARD',
        creditCardId: shopee,
        startMonth: '2026-10-01',
        endMonth: null,
        beneficiaryUserId: null,
      }),
    ).rejects.toThrow(/crediário/);
    await expect(q(`update credit_cards set closing_day = 3 where id = $1`, [shopee])).rejects.toThrow(
      /credit_cards_kind_rule/,
    );
  });
});

describe('ciclo da fatura (D73)', () => {
  it('1ª compra: fatura vence em 40 dias e fecha 7 antes; parcelas mês a mês no mesmo dia', async () => {
    const { planId } = await createCardPurchase(ctx, purchase());
    expect(await invoicesOf(shopee)).toMatchObject([
      { ref: '2026-11-01', closing: '2026-11-19', due: '2026-11-26', total: '3834' },
      { ref: '2026-12-01', closing: '2026-12-19', due: '2026-12-26', total: '3833' },
      { ref: '2027-01-01', closing: '2027-01-19', due: '2027-01-26', total: '3833' },
    ]);
    expect(await dueDayOf(shopee)).toBe(26);
    const [plan] = await q(
      `select total_amount_cents::int total, original_amount_cents::int original from installment_plans where id = $1`,
      [planId],
    );
    expect(plan).toEqual({ total: 11_500, original: 10_000 });
  });

  it('compras até o fechamento caem na mesma fatura; depois dele, na do mês seguinte', async () => {
    await createCardPurchase(ctx, purchase({ amount: 2_000, originalAmount: undefined, installments: 1 }));
    await createCardPurchase(
      at('2026-11-18'),
      purchase({ date: '2026-11-18', amount: 3_000, originalAmount: undefined, installments: 1 }),
    );
    await createCardPurchase(
      at('2026-11-19'),
      purchase({ date: '2026-11-19', amount: 4_000, originalAmount: undefined, installments: 1 }),
    );
    expect(await invoicesOf(shopee)).toMatchObject([
      { due: '2026-11-26', total: '5000' },
      { due: '2026-12-26', total: '4000' },
    ]);
  });

  it('tudo vencido e pago: a próxima compra abre um ciclo novo de 40 dias', async () => {
    await createCardPurchase(ctx, purchase({ amount: 2_000, originalAmount: undefined, installments: 1 }));
    const [nov] = await invoicesOf(shopee);
    await payInvoice(at('2026-11-20'), nov!.id, { amount: 2_000, date: '2026-11-20', paymentMethod: 'PIX' });
    await createCardPurchase(
      at('2026-11-30'),
      purchase({ date: '2026-11-30', amount: 1_000, originalAmount: undefined, installments: 1 }),
    );
    expect((await invoicesOf(shopee)).at(-1)).toMatchObject({
      ref: '2027-01-01',
      closing: '2027-01-02',
      due: '2027-01-09',
      total: '1000',
    });
    expect(await dueDayOf(shopee)).toBe(9);
  });

  it('fatura vencida sem pagar: o ciclo continua mensal', async () => {
    await createCardPurchase(ctx, purchase({ amount: 2_000, originalAmount: undefined, installments: 1 }));
    await createCardPurchase(
      at('2026-11-30'),
      purchase({ date: '2026-11-30', amount: 1_000, originalAmount: undefined, installments: 1 }),
    );
    expect((await invoicesOf(shopee)).at(-1)).toMatchObject({ due: '2026-12-26', total: '1000' });
    expect(await dueDayOf(shopee)).toBe(26);
  });
});

describe('juros, limite e relatórios', () => {
  it('o total com juros conta no limite, no Gasto Bruto e nas Saídas do mês da fatura', async () => {
    await createCardPurchase(ctx, purchase());
    expect(await availableLimit(shopee)).toBe(65_000 - 11_500);
    expect(await grossSpend('2026-10-01')).toBe(11_500);
    const [summary] = await listCardSummaries(db, '2026-10-17');
    expect(summary!.availableCents).toBe(53_500);
    expect(summary!.currentInvoice).toMatchObject({ dueDate: '2026-11-26', totalCents: 3_834 });

    const nov = await cashSummary(db, '2026-11-01', '2026-10-17');
    expect(nov!.outTotalCents).toBe(3_834); // a fatura do crediário nas Saídas de novembro
  });

  it('detalhe da compra: acréscimo, % sobre o original e taxa mensal', async () => {
    const { planId } = await createCardPurchase(ctx, purchase());
    const d = await getPlanDetail(db, planId, '2026-10-17');
    expect(d!.interest).toMatchObject({ extraCents: 1_500, percent: 15 });
    expect(d!.interest!.monthlyRate).toBeGreaterThan(5);
    expect(d!.interest!.monthlyRate).toBeLessThan(8);
  });

  it('total menor que o valor da compra é recusado (lançar e editar)', async () => {
    await expect(createCardPurchase(ctx, purchase({ originalAmount: 12_000 }))).rejects.toThrow(
      /não pode ser menor que o valor da compra/,
    );
    const { planId } = await createCardPurchase(ctx, purchase());
    await expect(
      updateCardPurchase(ctx, planId, {
        description: 'Fone',
        categoryId: mercado,
        beneficiaryUserId: null,
        notes: null,
        amount: 9_000,
      }),
    ).rejects.toThrow(/não pode ser menor/);
    await updateCardPurchase(ctx, planId, {
      description: 'Fone',
      categoryId: mercado,
      beneficiaryUserId: null,
      notes: null,
      amount: 12_000,
      originalAmount: 10_500,
    });
    const d = await getPlanDetail(db, planId, '2026-10-17');
    expect(d!.interest!.extraCents).toBe(1_500);
  });

  it('antecipar a última parcela com desconto libera o limite bruto', async () => {
    const { planId } = await createCardPurchase(ctx, purchase());
    const [, , p3] = await q<{ id: string }>(
      `select id from invoice_items where installment_plan_id = $1 order by installment_number`,
      [planId],
    );
    const a = await anticipate(at('2026-10-20'), planId, {
      itemIds: [p3!.id],
      paid: 3_500,
      date: '2026-10-20',
      settlement: 'DIRECT_PAYMENT',
      targetInvoiceId: null,
    });
    expect(a).toMatchObject({ grossCents: 3_833, discountCents: 333 });
    expect(await availableLimit(shopee)).toBe(65_000 - 11_500 + 3_833);
  });
});

describe('parcelamento em andamento no crediário', () => {
  it('sem faturas ainda: o vencimento informado define o dia do ciclo', async () => {
    await createOnboardingPlan(ctx, {
      cardId: shopee,
      description: 'Geladeira',
      total: 60_000,
      installments: 6,
      currentInstallment: 5,
      purchaseDate: '2026-05-10',
      currentInvoiceMonth: '2026-11-01',
      currentInvoiceDue: '2026-11-05',
      categoryId: mercado,
      beneficiaryUserId: null,
    });
    expect(await invoicesOf(shopee)).toMatchObject([
      { due: '2026-11-05', closing: '2026-10-29', total: '10000' },
      { due: '2026-12-05', total: '10000' },
    ]);
    // compra nova entra no ciclo que já existe (fatura de novembro fecha em 29/10)
    await createCardPurchase(ctx, purchase({ amount: 1_000, originalAmount: undefined, installments: 1 }));
    expect(await invoicesOf(shopee)).toMatchObject([
      { due: '2026-11-05', total: '11000' },
      { total: '10000' },
    ]);
  });

  it('exige o vencimento da fatura da parcela atual', async () => {
    await expect(
      createOnboardingPlan(ctx, {
        cardId: shopee,
        description: 'Geladeira',
        total: 60_000,
        installments: 6,
        currentInstallment: 5,
        purchaseDate: '2026-05-10',
        currentInvoiceMonth: '2026-11-01',
        currentInvoiceDue: undefined,
        categoryId: mercado,
        beneficiaryUserId: null,
      }),
    ).rejects.toThrow(/vencimento da fatura/);
  });
});
