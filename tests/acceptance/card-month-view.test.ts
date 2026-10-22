/**
 * Cartões no mês escolhido no seletor (21/10/2026): a fatura do mês de referência escolhido por cartão, ou nenhuma
 * (o cartão "sem fatura" aparece zerado e avisado), e a fatura onde cada compra cai (para onde a tela volta
 * depois de lançar). Postgres real (PGlite).
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { listCardMonthViews } from '@/db/queries/cards';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { createCardPurchase } from '@/server/card-purchases';
import { createCard } from '@/server/cards';
import type { ServiceCtx } from '@/server/context';
import { freshDb } from './helpers';

const TODAY = '2026-10-21';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let a: string;
let b: string;
let mercado: string;

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;

const buy = (cardId: string, date: string, amount: number, installments = 1, description = 'Compra') =>
  createCardPurchase(ctx, {
    cardId,
    amount,
    installments,
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
  const userId = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId, today: TODAY };
  const card = (name: string, closingDay: number, dueDay: number) =>
    createCard(ctx, {
      name,
      issuer: 'Nubank',
      last4: null,
      isAdditional: false,
      holderName: null,
      limitTotal: 500_000,
      closingDay,
      dueDay,
      botAliases: [],
    });
  a = (await card('Cartão A', 9, 16)).id;
  b = (await card('Cartão B', 3, 10)).id;
});

describe('para onde volta depois de lançar: a fatura onde a compra caiu', () => {
  it('compra à vista e parcelada devolvem a fatura da 1ª parcela', async () => {
    const vista = await buy(a, '2026-10-05', 10_000); // fecha 09/10 → fatura de outubro
    const depois = await buy(a, '2026-10-12', 10_000); // depois do fechamento → novembro
    const parcelada = await buy(a, '2026-10-12', 30_000, 3);
    const ref = async (invoiceId: string) =>
      (await q<{ r: string }>(`select reference_month::text r from invoices where id = $1`, [invoiceId]))[0]!
        .r;
    expect(await ref(vista.invoiceId)).toBe('2026-10-01');
    expect(await ref(depois.invoiceId)).toBe('2026-11-01');
    expect(await ref(parcelada.invoiceId)).toBe('2026-11-01'); // a 1ª parcela, não a última
    expect(depois.invoiceId).toBe(parcelada.invoiceId);
  });
});

describe('cartões no mês escolhido', () => {
  it('cada cartão mostra a fatura do mês de referência escolhido; sem fatura = null (zerado e avisado na tela)', async () => {
    await buy(a, '2026-10-05', 10_000); // A: outubro
    await buy(a, '2026-10-12', 20_000); // A: novembro
    await buy(b, '2026-10-12', 5_000); // B: novembro (fecha dia 3)

    const set = async (month: string | null) => await listCardMonthViews(db, TODAY, month);
    const by = (views: Awaited<ReturnType<typeof set>>, id: string) => views.find((v) => v.card.id === id)!;

    // sem mês: o mês atual (outubro)
    const current = await set(null);
    expect(by(current, a)).toMatchObject({
      viewMonth: '2026-10-01',
      isCurrentMonth: true,
      monthInvoice: { referenceMonth: '2026-10-01', totalCents: 10_000 },
    });
    // a fatura aberta (a que acumula compras) continua sendo a de novembro: é o destaque do mês atual
    expect(by(current, a).currentInvoice).toMatchObject({ referenceMonth: '2026-11-01', totalCents: 20_000 });
    // B não tem fatura de outubro lançada
    expect(by(current, b).monthInvoice).toBeNull();

    // mês anterior: sem nenhuma fatura em nenhum cartão
    const sep = await set('2026-09-01');
    expect(sep.every((v) => v.monthInvoice === null)).toBe(true);
    expect(by(sep, a)).toMatchObject({ viewMonth: '2026-09-01', isCurrentMonth: false });

    // novembro: cada cartão com o seu valor
    const nov = await set('2026-11-01');
    expect(by(nov, a).monthInvoice).toMatchObject({ referenceMonth: '2026-11-01', totalCents: 20_000 });
    expect(by(nov, b).monthInvoice).toMatchObject({ referenceMonth: '2026-11-01', totalCents: 5_000 });

    // o limite é sempre o de agora, em qualquer mês escolhido
    expect(by(sep, a).availableCents).toBe(500_000 - 30_000);
    expect(by(nov, a).availableCents).toBe(500_000 - 30_000);
  });
});
