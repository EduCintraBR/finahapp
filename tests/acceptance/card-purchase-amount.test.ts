/**
 * Editar o valor de uma compra no cartão (D62): muda o total, refaz as parcelas (resto na 1ª) e as faturas
 * acompanham; não muda depois que alguma parcela caiu em fatura fechada, antecipação ou estorno. Postgres real (PGlite).
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { createCardPurchase, updateCardPurchase } from '@/server/card-purchases';
import { refundPurchase } from '@/server/invoice-ops';
import { createCard } from '@/server/cards';
import type { ServiceCtx } from '@/server/context';
import { freshDb } from './helpers';

const TODAY = '2026-10-21';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let card: string;
let mercado: string;

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;

const buy = (date: string, amount: number, installments: number) =>
  createCardPurchase(ctx, {
    cardId: card,
    amount,
    installments,
    description: 'Geladeira',
    categoryId: mercado,
    date,
    beneficiaryUserId: null,
    notes: null,
  });

const itemAmounts = (planId: string) =>
  q<{ n: number; amount: number }>(
    `select installment_number n, amount_cents amount from invoice_items where installment_plan_id = $1 and status = 'ACTIVE' order by installment_number`,
    [planId],
  );

const edit = (planId: string, amount: number | undefined) =>
  updateCardPurchase(ctx, planId, {
    description: 'Geladeira',
    categoryId: mercado,
    beneficiaryUserId: null,
    notes: null,
    ...(amount === undefined ? {} : { amount }),
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
  const userId = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId, today: TODAY };
  card = (
    await createCard(ctx, {
      name: 'Cartão A',
      issuer: 'Nubank',
      last4: null,
      isAdditional: false,
      holderName: null,
      limitTotal: 500_000,
      closingDay: 9,
      dueDay: 16,
      botAliases: [],
    })
  ).id;
});

describe('editar o valor de uma compra no cartão', () => {
  it('refaz as parcelas com o resto na 1ª, atualiza o total e mantém a soma exata', async () => {
    const { planId, transactionId } = await buy('2026-10-12', 10_000, 3); // fatura aberta: novembro em diante
    await edit(planId, 20_000);
    const items = await itemAmounts(planId);
    expect(items.map((i) => i.amount)).toEqual([6668, 6666, 6666]);
    expect(items.reduce((s, i) => s + i.amount, 0)).toBe(20_000);
    expect(
      await q<{ t: number }>(`select total_amount_cents t from installment_plans where id = $1`, [planId]),
    ).toEqual([{ t: 20_000 }]);
    expect(
      await q<{ a: number }>(`select amount_cents a from transactions where id = $1`, [transactionId]),
    ).toEqual([{ a: 20_000 }]);
  });

  it('sem valor (ou igual ao atual) só edita o texto, mesmo com fatura fechada', async () => {
    const { planId } = await buy('2026-10-05', 9_000, 1); // fatura de outubro já fechou
    await edit(planId, undefined);
    await edit(planId, 9_000);
    expect((await itemAmounts(planId)).map((i) => i.amount)).toEqual([9_000]);
  });

  it('recusa mudar o valor se alguma parcela já está em fatura fechada', async () => {
    const { planId } = await buy('2026-10-05', 9_000, 1);
    await expect(edit(planId, 12_000)).rejects.toThrow('o valor não pode mudar');
    expect((await itemAmounts(planId)).map((i) => i.amount)).toEqual([9_000]);
  });

  it('recusa mudar o valor depois de estorno (e a compra fica como estava)', async () => {
    const { planId } = await buy('2026-10-12', 10_000, 3);
    await refundPurchase(ctx, planId, {
      mode: 'CREDIT_KEEP_INSTALLMENTS',
      amount: 1_000,
      refundDate: '2026-10-20',
      targetInvoiceId: (
        await q<{ id: string }>(
          `select invoice_id id from invoice_items where installment_plan_id = $1 and installment_number = 1`,
          [planId],
        )
      )[0]!.id,
      reason: null,
    });
    await expect(edit(planId, 12_000)).rejects.toThrow('o valor não pode mudar');
    expect((await itemAmounts(planId)).map((i) => i.amount)).toEqual([3334, 3333, 3333, -1000]); // parcelas + o crédito do estorno (sem alteração)
  });
});
