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
import { createCard, updateCard, updateInvoiceDates } from '@/server/cards';
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

describe('mudar o dia do vencimento das faturas (D73)', () => {
  const inv = (ref: string) =>
    q<{ id: string; closing: string; due: string }>(
      `select id, closing_date::text closing, due_date::text due from invoices
       where credit_card_id = $1 and reference_month = $2`,
      [shopee, ref],
    ).then((r) => r[0]!);
  const dueDays = async () =>
    (await invoicesOf(shopee)).map((i) => [i.ref.slice(0, 7), i.due.slice(8), i.closing.slice(5)]);
  const buy = (over: Partial<CardPurchaseInput>) =>
    createCardPurchase(
      at(over.date ?? '2026-10-17'),
      purchase({ originalAmount: undefined, installments: 1, amount: 1_000, ...over }),
    );

  // compra de 17/10: faturas de 26/11, 26/12 e 26/01 (fecham dia 19)
  beforeEach(async () => {
    await createCardPurchase(ctx, purchase());
  });

  it('o vencimento escolhido vale para a fatura e para todas as seguintes, e para as novas', async () => {
    const nov = await inv('2026-11-01');
    await updateInvoiceDates(ctx, nov.id, {
      closingDate: nov.closing,
      dueDate: '2026-11-20',
      applyToNext: true,
    });
    // fechamento = vencimento − 7 dias, em cada fatura
    expect(await dueDays()).toEqual([
      ['2026-11', '20', '11-13'],
      ['2026-12', '20', '12-13'],
      ['2027-01', '20', '01-13'],
    ]);
    expect(await dueDayOf(shopee)).toBe(20);
    // uma compra em 5× cria faturas novas: seguem o dia 20
    await buy({ date: '2026-10-20', installments: 5, amount: 5_000 });
    expect((await invoicesOf(shopee)).map((i) => i.due.slice(8))).toEqual(['20', '20', '20', '20', '20']);
  });

  it('compra feita entre o fechamento novo e o antigo passa para a fatura seguinte', async () => {
    await buy({ date: '2026-11-10', description: 'Fica' });
    await buy({ date: '2026-11-15', description: 'Muda' });
    const nov = await inv('2026-11-01');
    const r = await updateInvoiceDates(ctx, nov.id, {
      closingDate: nov.closing,
      dueDate: '2026-11-20',
      applyToNext: true,
    });
    expect(r.moved).toEqual([{ description: 'Muda', direction: 'forward' }]);
    const where = (d: string) =>
      q<{ ref: string }>(
        `select v.reference_month::text ref from invoice_items i join invoices v on v.id = i.invoice_id
         where i.description = $1`,
        [d],
      ).then((x) => x.map((y) => y.ref.slice(0, 7)));
    expect(await where('Fica')).toEqual(['2026-11']);
    expect(await where('Muda')).toEqual(['2026-12']);
    expect(await availableLimit(shopee)).toBe(65_000 - 11_500 - 2_000); // o limite não muda
    // e a próxima compra segue a regra nova: depois do dia 13, vai para a fatura de dezembro
    await buy({ date: '2026-11-14', description: 'Depois' });
    expect((await invoicesOf(shopee)).map((i) => i.total)).toEqual(['4834', '5833', '3833']);
  });

  it('mudando uma fatura do meio, as anteriores ficam como estão', async () => {
    const dec = await inv('2026-12-01');
    await updateInvoiceDates(ctx, dec.id, {
      closingDate: dec.closing,
      dueDate: '2026-12-20',
      applyToNext: true,
    });
    expect(await dueDays()).toEqual([
      ['2026-11', '26', '11-19'],
      ['2026-12', '20', '12-13'],
      ['2027-01', '20', '01-13'],
    ]);
  });

  it('fatura já fechada só muda o vencimento; as seguintes mudam por inteiro', async () => {
    const nov = await inv('2026-11-01');
    // 22/11: a de novembro fechou dia 19 e vence dia 26
    await updateInvoiceDates(at('2026-11-22'), nov.id, {
      closingDate: nov.closing,
      dueDate: '2026-11-25',
      applyToNext: true,
    });
    expect(await dueDays()).toEqual([
      ['2026-11', '25', '11-19'],
      ['2026-12', '25', '12-18'],
      ['2027-01', '25', '01-18'],
    ]);
    expect(await dueDayOf(shopee)).toBe(25);
  });

  it('fatura paga não muda e não pode ser a escolhida', async () => {
    const nov = await inv('2026-11-01');
    await payInvoice(at('2026-11-20'), nov.id, { amount: 3_834, date: '2026-11-20', paymentMethod: 'PIX' });
    await expect(
      updateInvoiceDates(at('2026-11-20'), nov.id, {
        closingDate: nov.closing,
        dueDate: '2026-11-20',
        applyToNext: true,
      }),
    ).rejects.toThrow(/já foi paga/);
    const dec = await inv('2026-12-01');
    await updateInvoiceDates(at('2026-11-20'), dec.id, {
      closingDate: dec.closing,
      dueDate: '2026-12-20',
      applyToNext: true,
    });
    expect((await dueDays())[0]).toEqual(['2026-11', '26', '11-19']); // a paga ficou
    expect(await dueDayOf(shopee)).toBe(20);
  });

  it('recusa sem deixar nada pela metade: vencimento antes do fechamento já ocorrido, e compra travada', async () => {
    const nov = await inv('2026-11-01');
    await expect(
      updateInvoiceDates(at('2026-11-22'), nov.id, {
        closingDate: nov.closing,
        dueDate: '2026-11-15',
        applyToNext: true,
      }),
    ).rejects.toThrow(/depois do fechamento/);

    // compra de 15/11 em 2× com a 2ª parcela antecipada: não pode trocar de fatura
    const { planId } = await buy({
      date: '2026-11-15',
      description: 'Travada',
      installments: 2,
      amount: 2_000,
    });
    const [, p2] = await q<{ id: string }>(
      `select id from invoice_items where installment_plan_id = $1 order by installment_number`,
      [planId],
    );
    await anticipate(at('2026-11-16'), planId, {
      itemIds: [p2!.id],
      paid: 1_000,
      date: '2026-11-16',
      settlement: 'DIRECT_PAYMENT',
      targetInvoiceId: null,
    });
    const before = await dueDays();
    await expect(
      updateInvoiceDates(ctx, nov.id, { closingDate: nov.closing, dueDate: '2026-11-20', applyToNext: true }),
    ).rejects.toThrow(/mudaria de fatura/);
    expect(await dueDays()).toEqual(before);
    expect(await dueDayOf(shopee)).toBe(26);
  });

  it('sem marcar "próximas faturas", muda só aquela fatura e o cadastro fica como está', async () => {
    const dec = await inv('2026-12-01');
    await updateInvoiceDates(ctx, dec.id, { closingDate: '2026-12-18', dueDate: '2026-12-22' });
    expect(await dueDays()).toEqual([
      ['2026-11', '26', '11-19'],
      ['2026-12', '22', '12-18'],
      ['2027-01', '26', '01-19'],
    ]);
    expect(await dueDayOf(shopee)).toBe(26);
  });

  it('cartão comum não aceita a opção', async () => {
    const nubank = (
      await createCard(ctx, {
        name: 'Nubank',
        issuer: 'Nubank',
        last4: null,
        isAdditional: false,
        holderName: null,
        limitTotal: 100_000,
        closingDay: 3,
        dueDay: 10,
        botAliases: [],
      })
    ).id;
    await createCardPurchase(ctx, purchase({ cardId: nubank, originalAmount: undefined, installments: 1 }));
    const [row] = await q<{ id: string; closing: string }>(
      `select id, closing_date::text closing from invoices where credit_card_id = $1`,
      [nubank],
    );
    await expect(
      updateInvoiceDates(ctx, row!.id, {
        closingDate: row!.closing,
        dueDate: '2026-11-12',
        applyToNext: true,
      }),
    ).rejects.toThrow(/só vale para crediário/);
  });
});
