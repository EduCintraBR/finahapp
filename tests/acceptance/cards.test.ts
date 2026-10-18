/**
 * Fase 3 — motor de cartões pelos SERVIÇOS de produção, contra Postgres real (PGlite).
 * Os números são conferidos com as fórmulas de referência de tests/acceptance/card-ledger.test.ts.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { createCardPurchase, createOnboardingPlan, deleteCardPurchase } from '@/server/card-purchases';
import { createCard, updateInvoiceDates } from '@/server/cards';
import type { ServiceCtx } from '@/server/context';
import {
  anticipate,
  invoiceStateOf,
  payInvoice,
  refundPurchase,
  removeInvoicePayment,
} from '@/server/invoice-ops';
import { createTemplate, generateOccurrences } from '@/server/recurring';
import type { CardPurchaseInput } from '@/server/schemas';
import { getInvoiceDetail, listCardInvoices, listCardSummaries } from '@/db/queries/cards';
import { freshDb } from './helpers';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let card: string;
let accountId: string;
let mercado: string;

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;
const at = (today: string): ServiceCtx => ({ ...ctx, today });

// ─────────── fórmulas de referência (copiadas de card-ledger.test.ts) ───────────
const availableLimit = async (cardId: string) => {
  const [r] = await q<{ v: string | null }>(
    `select case when c.limit_total_cents is null then null else
      c.limit_total_cents
      - coalesce((select sum(i.amount_cents) from invoice_items i
                  where i.credit_card_id = c.id and i.status = 'ACTIVE'), 0)
      + coalesce((select sum(t.amount_cents) from transactions t
                  join invoices v on v.id = t.paid_invoice_id
                  where v.credit_card_id = c.id and t.kind = 'INVOICE_PAYMENT'
                    and t.status = 'POSTED' and t.deleted_at is null), 0)
    end as v from credit_cards c where c.id = $1`,
    [cardId],
  );
  return r!.v === null ? null : Number(r!.v);
};
const balance = async () =>
  Number(
    (
      await q<{ v: string }>(
        `select a.opening_balance_cents + coalesce(sum(case
          when t.kind in ('INCOME','TRANSFER_IN','ADJUSTMENT_IN') then t.amount_cents else -t.amount_cents end), 0) as v
        from bank_accounts a
        left join transactions t on t.bank_account_id = a.id and t.status = 'POSTED' and t.deleted_at is null
        where a.id = $1 group by a.id`,
        [accountId],
      )
    )[0]!.v,
  );
const grossSpend = async (month: string) =>
  Number(
    (
      await q<{ v: string }>(
        `select coalesce((select sum(amount_cents) from transactions
            where kind = 'EXPENSE' and status <> 'CANCELLED' and deleted_at is null and source <> 'ONBOARDING'
              and date_trunc('month', transaction_date) = $1::date), 0)
          - coalesce((select sum(amount_cents) from refund_records
              where date_trunc('month', refund_date) = $1::date), 0) as v`,
        [month],
      )
    )[0]!.v,
  );
const invoiceId = async (ref: string, cardId = card) =>
  (
    await q<{ id: string }>(`select id from invoices where credit_card_id = $1 and reference_month = $2`, [
      cardId,
      ref,
    ])
  )[0]?.id;
const invoiceTotal = async (ref: string) =>
  Number(
    (
      await q<{ v: string }>(
        `select coalesce(sum(i.amount_cents),0) v from invoice_items i join invoices v on v.id = i.invoice_id
         where v.credit_card_id = $1 and v.reference_month = $2 and i.status = 'ACTIVE'`,
        [card, ref],
      )
    )[0]!.v,
  );
const items = (planId: string) =>
  q<{ n: number; status: string; ref: string; amount: string; kind: string }>(
    `select i.installment_number n, i.status, v.reference_month::text ref, i.amount_cents::text amount, i.kind
     from invoice_items i join invoices v on v.id = i.invoice_id where i.installment_plan_id = $1
     order by i.kind, i.installment_number`,
    [planId],
  );

const purchase = (over: Partial<CardPurchaseInput> = {}): CardPurchaseInput => ({
  cardId: card,
  amount: 10_000,
  installments: 3,
  description: 'Compra',
  categoryId: mercado,
  date: '2026-10-16',
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
  accountId = (await q<{ id: string }>(`select id from bank_accounts`))[0]!.id;
  mercado = (await q<{ id: string }>(`select id from categories where name = 'Mercado'`))[0]!.id;
  const eduardo = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId: eduardo, today: '2026-10-17' };
  card = (
    await createCard(ctx, {
      name: 'Nubank Eduardo',
      issuer: 'Nubank',
      last4: '1234',
      isAdditional: false,
      holderName: null,
      limitTotal: 500_000,
      closingDay: 3,
      dueDay: 10,
      botAliases: ['nubank', 'roxinho'],
    })
  ).id;
});

describe('compra no cartão (invariante 4 e 5)', () => {
  it('parcelado: 1 transaction + 1 plano + 3 parcelas, resto na 1ª, faturas consecutivas', async () => {
    const { planId } = await createCardPurchase(ctx, purchase());
    expect(await items(planId)).toEqual([
      { n: 1, status: 'ACTIVE', ref: '2026-11-01', amount: '3334', kind: 'INSTALLMENT' },
      { n: 2, status: 'ACTIVE', ref: '2026-12-01', amount: '3333', kind: 'INSTALLMENT' },
      { n: 3, status: 'ACTIVE', ref: '2027-01-01', amount: '3333', kind: 'INSTALLMENT' },
    ]);
    expect(await availableLimit(card)).toBe(490_000); // compromete o total na hora
    expect(await balance()).toBe(500_000); // compra no cartão não mexe no saldo
    expect(await grossSpend('2026-10-01')).toBe(10_000);
    const [inv] = await q<{ closing: string; due: string }>(
      `select closing_date::text closing, due_date::text due from invoices where reference_month = '2026-11-01'`,
    );
    expect(inv).toEqual({ closing: '2026-11-03', due: '2026-11-10' });
  });

  it('comprar no dia do fechamento vai para a fatura seguinte', async () => {
    const { planId } = await createCardPurchase(
      at('2026-11-03'),
      purchase({ installments: 1, date: '2026-11-03' }),
    );
    expect((await items(planId))[0]!.ref).toBe('2026-12-01');
  });

  it('validações em pt-BR', async () => {
    await expect(createCardPurchase(ctx, purchase({ date: '2026-09-30' }))).rejects.toThrow(
      'Parcelamento em andamento',
    );
    await expect(createCardPurchase(ctx, purchase({ amount: 2, installments: 3 }))).rejects.toThrow(
      'R$ 0,01',
    );
  });
});

describe('fatura: pagamento e situação (D25, D30)', () => {
  it('pagar libera o limite, sai do saldo e quita a fatura', async () => {
    await createCardPurchase(ctx, purchase());
    const nov = (await invoiceId('2026-11-01'))!;
    await payInvoice(at('2026-11-10'), nov, { amount: 3334, date: '2026-11-10', paymentMethod: 'PIX' });
    expect(await availableLimit(card)).toBe(493_334);
    expect(await balance()).toBe(496_666);
    expect(await grossSpend('2026-11-01')).toBe(0); // INVOICE_PAYMENT não é gasto (invariante 6)
    const s = await db.transaction((tx) => invoiceStateOf(tx as never, nov, '2026-11-10'));
    expect(s).toMatchObject({ totalCents: 3334, paidCents: 3334, state: 'PAID' });
    const [row] = await q<{ status: string; paid_at: string }>(
      `select status, paid_at::text from invoices where id = $1`,
      [nov],
    );
    expect(row).toEqual({ status: 'PAID', paid_at: '2026-11-10' });
  });

  it('parcial: o restante fica na fatura, que atrasa depois do vencimento', async () => {
    await createCardPurchase(ctx, purchase());
    const nov = (await invoiceId('2026-11-01'))!;
    const { transactionId } = await payInvoice(at('2026-11-10'), nov, {
      amount: 1000,
      date: '2026-11-10',
      paymentMethod: 'PIX',
    });
    const s = await db.transaction((tx) => invoiceStateOf(tx as never, nov, '2026-11-11'));
    expect(s).toMatchObject({ paidCents: 1000, state: 'OVERDUE' });
    await removeInvoicePayment(at('2026-11-11'), transactionId);
    expect(await balance()).toBe(500_000);
  });
});

describe('antecipação e estornos (cenários da referência)', () => {
  it('compra → pagamento → antecipação avulsa → estorno Modo B (D26)', async () => {
    const { planId } = await createCardPurchase(ctx, purchase());
    const [nov, dec] = [await invoiceId('2026-11-01'), await invoiceId('2026-12-01')];
    await payInvoice(at('2026-11-10'), nov!, { amount: 3334, date: '2026-11-10', paymentMethod: 'PIX' });

    const p3 = (
      await q<{ id: string }>(
        `select id from invoice_items where installment_plan_id = $1 and installment_number = 3`,
        [planId],
      )
    )[0]!.id;
    const a = await anticipate(at('2026-11-12'), planId, {
      itemIds: [p3],
      paid: 3200,
      date: '2026-11-12',
      settlement: 'DIRECT_PAYMENT',
      targetInvoiceId: null,
    });
    expect(a).toMatchObject({ grossCents: 3333, discountCents: 133, paidCents: 3200 });
    expect(await availableLimit(card)).toBe(496_667); // libera o BRUTO
    expect(await balance()).toBe(493_466); // caixa sai o LÍQUIDO

    const r = await refundPurchase(at('2026-11-20'), planId, {
      mode: 'CANCEL_PURCHASE',
      amount: null,
      refundDate: '2026-11-20',
      targetInvoiceId: dec!,
      reason: null,
    });
    // parcela 2 (fatura aberta) cancelada; crédito = parcela 1 já cobrada + antecipação paga
    expect(r).toEqual({
      refundId: expect.any(String),
      grossRefundCents: 10_000,
      creditCents: 3334 + 3200,
      cancelledItems: 1,
    });
    expect(await invoiceTotal('2026-12-01')).toBe(-6534);
    expect(await availableLimit(card)).toBe(506_534); // saldo credor no cartão
    expect(await grossSpend('2026-10-01')).toBe(10_000); // mês da compra intacto
    expect(await grossSpend('2026-11-01')).toBe(-10_000); // estorno abate o mês do estorno
    expect(
      (await q<{ status: string }>(`select status from installment_plans where id = $1`, [planId]))[0]!
        .status,
    ).toBe('CANCELLED');
  });

  it('estorno Modo A: crédito na fatura, parcelas continuam', async () => {
    const { planId } = await createCardPurchase(ctx, purchase());
    const dec = (await invoiceId('2026-12-01'))!;
    await refundPurchase(at('2026-11-20'), planId, {
      mode: 'CREDIT_KEEP_INSTALLMENTS',
      amount: 10_000,
      refundDate: '2026-11-20',
      targetInvoiceId: dec,
      reason: 'devolução',
    });
    expect(await invoiceTotal('2026-12-01')).toBe(3333 - 10_000);
    expect(await invoiceTotal('2027-01-01')).toBe(3333);
    expect(await availableLimit(card)).toBe(500_000);
    await expect(
      refundPurchase(at('2026-11-21'), planId, {
        mode: 'CREDIT_KEEP_INSTALLMENTS',
        amount: 1,
        refundDate: '2026-11-21',
        targetInvoiceId: dec,
        reason: null,
      }),
    ).rejects.toThrow('não pode passar');
  });

  it('antecipação na fatura: líquido entra na fatura aberta; plano totalmente antecipado', async () => {
    const { planId } = await createCardPurchase(ctx, purchase());
    const nov = (await invoiceId('2026-11-01'))!;
    const ids = (
      await q<{ id: string }>(
        `select id from invoice_items where installment_plan_id = $1 and installment_number in (2,3)`,
        [planId],
      )
    ).map((r) => r.id);
    await anticipate(at('2026-10-20'), planId, {
      itemIds: ids,
      paid: 6400,
      date: '2026-10-20',
      settlement: 'ON_INVOICE',
      targetInvoiceId: nov,
    });
    expect(await invoiceTotal('2026-11-01')).toBe(3334 + 6400);
    expect(await invoiceTotal('2026-12-01')).toBe(0);
    expect(await availableLimit(card)).toBe(500_000 - 9734);
    expect(await grossSpend('2026-10-01')).toBe(10_000); // desconto não reduz o bruto (D7)
    const [plan] = await q<{ status: string }>(`select status from installment_plans where id = $1`, [
      planId,
    ]);
    expect(plan!.status).toBe('ACTIVE'); // parcela 1 ainda ativa

    const p1 = (
      await q<{ id: string }>(
        `select id from invoice_items where installment_plan_id = $1 and installment_number = 1`,
        [planId],
      )
    )[0]!.id;
    await expect(
      anticipate(at('2026-11-05'), planId, {
        itemIds: [p1],
        paid: 3000,
        date: '2026-11-05',
        settlement: 'DIRECT_PAYMENT',
        targetInvoiceId: null,
      }),
    ).rejects.toThrow('ainda não fecharam');
  });
});

describe('parcelamento em andamento (onboarding)', () => {
  it('só parcelas restantes, fora do Gasto Bruto', async () => {
    const { planId } = await createOnboardingPlan(ctx, {
      cardId: card,
      description: 'Geladeira',
      total: 100_000,
      installments: 10,
      currentInstallment: 9,
      purchaseDate: '2026-03-05',
      currentInvoiceMonth: '2026-11-01',
      categoryId: mercado,
      beneficiaryUserId: null,
    });
    expect(await items(planId)).toEqual([
      { n: 9, status: 'ACTIVE', ref: '2026-11-01', amount: '10000', kind: 'INSTALLMENT' },
      { n: 10, status: 'ACTIVE', ref: '2026-12-01', amount: '10000', kind: 'INSTALLMENT' },
    ]);
    expect(await availableLimit(card)).toBe(480_000);
    expect(await grossSpend('2026-03-01')).toBe(0);
  });
});

describe('cartão adicional e exclusão (D28, D31)', () => {
  it('adicional sem limite rastreado; pagamento sai da conta principal', async () => {
    const add = (
      await createCard(ctx, {
        name: 'Nubank adicional',
        issuer: 'Nubank',
        last4: null,
        isAdditional: true,
        holderName: 'Mãe',
        limitTotal: null,
        closingDay: 3,
        dueDay: 10,
        botAliases: [],
      })
    ).id;
    await createCardPurchase(ctx, purchase({ cardId: add, installments: 1, amount: 5000 }));
    expect(await availableLimit(add)).toBeNull();
    await payInvoice(at('2026-11-10'), (await invoiceId('2026-11-01', add))!, {
      amount: 5000,
      date: '2026-11-10',
      paymentMethod: 'PIX',
    });
    expect(await balance()).toBe(495_000);
  });

  it('excluir só enquanto nada foi cobrado', async () => {
    const { planId } = await createCardPurchase(ctx, purchase());
    await deleteCardPurchase(ctx, planId);
    expect(await availableLimit(card)).toBe(500_000);
    expect(await grossSpend('2026-10-01')).toBe(0);

    const second = await createCardPurchase(ctx, purchase());
    await expect(deleteCardPurchase(at('2026-11-04'), second.planId)).rejects.toThrow('Estornar');
  });
});

describe('editar fechamento (D27)', () => {
  it('fechamento antecipado: a compra depois do novo fechamento anda uma fatura (todas as parcelas)', async () => {
    const early = await createCardPurchase(
      ctx,
      purchase({ date: '2026-10-30', installments: 1, description: 'Antes' }),
    );
    const late = await createCardPurchase(
      at('2026-11-02'),
      purchase({ date: '2026-11-02', installments: 2, description: 'Depois' }),
    );
    const nov = (await invoiceId('2026-11-01'))!;
    const r = await updateInvoiceDates(at('2026-11-02'), nov, {
      closingDate: '2026-11-02',
      dueDate: '2026-11-10',
    });
    expect(r.moved).toEqual([{ description: 'Depois', direction: 'forward' }]);
    expect((await items(early.planId)).map((i) => i.ref)).toEqual(['2026-11-01']);
    expect((await items(late.planId)).map((i) => i.ref)).toEqual(['2026-12-01', '2027-01-01']);
    expect(await availableLimit(card)).toBe(500_000 - 20_000);
  });

  it('fatura fechada não muda o fechamento; vencimento só no mesmo mês', async () => {
    await createCardPurchase(ctx, purchase());
    const nov = (await invoiceId('2026-11-01'))!;
    await expect(
      updateInvoiceDates(at('2026-11-04'), nov, { closingDate: '2026-11-02', dueDate: '2026-11-10' }),
    ).rejects.toThrow('aberta');
    await expect(
      updateInvoiceDates(ctx, nov, { closingDate: '2026-11-03', dueDate: '2026-12-01' }),
    ).rejects.toThrow('mesmo mês');
    await updateInvoiceDates(at('2026-11-04'), nov, { closingDate: '2026-11-03', dueDate: '2026-11-12' });
  });
});

describe('assinatura no cartão (D33)', () => {
  it('vira compra à vista no dia da cobrança, uma por mês, idempotente', async () => {
    const streaming = (await q<{ id: string }>(`select id from categories where name = 'Assinaturas'`))[0]!
      .id;
    await createTemplate(at('2026-10-14'), {
      type: 'FIXED',
      direction: 'EXPENSE',
      description: 'Netflix',
      categoryId: streaming,
      amount: 5_590,
      dayOfMonth: 15,
      paymentMethod: 'CREDIT_CARD',
      creditCardId: card,
      startMonth: '2026-10-01',
      endMonth: null,
      beneficiaryUserId: null,
    });
    expect(await q(`select 1 from transactions where description = 'Netflix'`)).toHaveLength(0); // dia 15 ainda não chegou
    expect(await generateOccurrences(db, '2026-12-20')).toBe(3);
    expect(await generateOccurrences(db, '2026-12-20')).toBe(0);
    const rows = await q<{ date: string; ref: string; source: string }>(
      `select t.transaction_date::text date, v.reference_month::text ref, t.source
       from transactions t join installment_plans p on p.transaction_id = t.id
       join invoice_items i on i.installment_plan_id = p.id join invoices v on v.id = i.invoice_id
       where t.description = 'Netflix' order by 1`,
    );
    expect(rows).toEqual([
      { date: '2026-10-15', ref: '2026-11-01', source: 'RECURRING' },
      { date: '2026-11-15', ref: '2026-12-01', source: 'RECURRING' },
      { date: '2026-12-15', ref: '2027-01-01', source: 'RECURRING' },
    ]);
    expect(await availableLimit(card)).toBe(500_000 - 3 * 5_590);
  });
});

describe('queries das telas (devem bater com as fórmulas de referência)', () => {
  it('resumo do cartão, lista de faturas e detalhe da fatura', async () => {
    await createCardPurchase(ctx, purchase());
    const nov = (await invoiceId('2026-11-01'))!;
    await payInvoice(ctx, nov, { amount: 1000, date: '2026-10-17', paymentMethod: 'PIX' });

    const [s] = await listCardSummaries(db, '2026-10-17');
    expect(s!.availableCents).toBe(await availableLimit(card));
    expect(s!.committedCents).toBe(10_000 - 1000);
    expect(s!.currentInvoice).toMatchObject({
      referenceMonth: '2026-11-01',
      totalCents: 3334,
      paidCents: 1000,
      state: 'OPEN',
    });
    expect(s!.activeInstallmentPlans).toBe(1);
    expect(s!.lastInstallmentMonth).toBe('2027-01-01');

    const list = await listCardInvoices(db, card, '2026-10-17');
    expect(list.map((i) => [i.referenceMonth, i.totalCents])).toEqual([
      ['2027-01-01', 3333],
      ['2026-12-01', 3333],
      ['2026-11-01', 3334],
    ]);

    const d = await getInvoiceDetail(db, nov, '2026-10-17');
    expect(d!.summary).toMatchObject({ totalCents: 3334, paidCents: 1000, remainingCents: 2334 });
    expect(d!.items).toHaveLength(1);
    expect(d!.payments).toHaveLength(1);
  });
});

describe('compra excluída some da fatura', () => {
  it('excluída não aparece nos itens; cancelada por estorno continua (histórico)', async () => {
    const deleted = await createCardPurchase(
      ctx,
      purchase({ description: 'Lançada errado', installments: 1 }),
    );
    const refunded = await createCardPurchase(ctx, purchase({ description: 'Devolvida', installments: 1 }));
    await deleteCardPurchase(ctx, deleted.planId);
    const nov = (await invoiceId('2026-11-01'))!;
    await refundPurchase(ctx, refunded.planId, {
      mode: 'CANCEL_PURCHASE',
      amount: null,
      refundDate: '2026-10-17',
      targetInvoiceId: nov,
      reason: null,
    });

    const d = await getInvoiceDetail(db, nov, '2026-10-17');
    expect(d!.items.map((i) => [i.description, i.status])).toEqual([['Devolvida', 'CANCELLED']]);
    expect(d!.summary.totalCents).toBe(0);
  });
});
