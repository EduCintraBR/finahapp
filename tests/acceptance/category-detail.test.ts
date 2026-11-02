/**
 * Detalhe da categoria e troca de categoria (D75), contra Postgres real (PGlite).
 * 1) A lista do detalhe soma EXATAMENTE a fatia do gráfico, nos dois modos, em todos os meses e com filtros.
 * 2) setTransactionCategory: cartão (plano e parcelas), fixos ("só este" / "este e os próximos"), pagamento
 *    antecipado (troca o par), empréstimo bloqueado, lock otimista e audit_log.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { categoryLines } from '@/db/queries/category-detail';
import {
  ADJUSTMENTS_KEY,
  grossSpend,
  monthlySpend,
  NO_CATEGORY_KEY,
  total,
  type ReportFilters,
} from '@/db/queries/reports';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { createCardPurchase, createOnboardingPlan } from '@/server/card-purchases';
import { createCard } from '@/server/cards';
import { createCategory } from '@/server/categories';
import { setTransactionCategory } from '@/server/categorize';
import type { ServiceCtx } from '@/server/context';
import { confirmPayment, createEntry } from '@/server/entries';
import { anticipate, refundPurchase } from '@/server/invoice-ops';
import { createLoan } from '@/server/loans';
import { createTemplate, generateOccurrences } from '@/server/recurring';
import { freshDb } from './helpers';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let card: string;
let planId: string;
let feiraId: string;
let horti: string;
const cat: Record<string, string> = {};

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;
const versionOf = async (id: string) =>
  (await q<{ version: number }>(`select version from transactions where id = $1`, [id]))[0]!.version;
const categoryOf = async (id: string) =>
  (await q<{ category_id: string }>(`select category_id from transactions where id = $1`, [id]))[0]!
    .category_id;

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
  horti = (
    await createCategory(ctx, { kind: 'EXPENSE', name: 'Hortifruti', aliases: [], parentId: cat['Mercado']! })
  ).id;

  const entry = { notes: null, beneficiaryUserId: null };
  feiraId = (
    await createEntry(ctx, {
      ...entry,
      kind: 'EXPENSE',
      amount: 10_000,
      description: 'Feira',
      categoryId: horti, // subcategoria: o detalhe da mãe tem que incluí-la
      paymentMethod: 'PIX',
      date: '2026-10-05',
    })
  ).id;
  await createEntry(ctx, {
    ...entry,
    kind: 'EXPENSE',
    amount: 4_000,
    description: 'Padaria',
    categoryId: cat['Mercado']!,
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
  planId = (
    await createCardPurchase(ctx, {
      cardId: card,
      amount: 120_000,
      installments: 12,
      description: 'TV',
      categoryId: cat['Mercado']!,
      date: '2026-10-16',
      beneficiaryUserId: null,
      notes: null,
    })
  ).planId;
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

describe('o detalhe soma exatamente a fatia', () => {
  const MONTHS = ['2026-02-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-10-01'];
  const FILTERS: ReportFilters[] = [
    {},
    { cardId: undefined, paymentMethod: 'PIX' },
    { paymentMethod: 'CREDIT_CARD' },
  ];

  for (const view of ['bruto', 'mensal'] as const) {
    it(`modo ${view}: cada chave do gráfico bate com a soma das suas linhas, nos meses e filtros`, async () => {
      const spend = view === 'bruto' ? grossSpend : monthlySpend;
      let checked = 0;
      for (const f of FILTERS) {
        for (const m of MONTHS) {
          const [from, to] = month(m);
          const totals = await spend(db, from, to, 'category', f);
          const keys = new Set([...totals.keys(), ADJUSTMENTS_KEY, NO_CATEGORY_KEY]);
          let all = 0;
          for (const key of keys) {
            const lines = await categoryLines(db, view, from, to, key, f);
            const sum = lines.reduce((s, l) => s + l.amountCents, 0);
            expect(sum, `${view} ${m} ${key} ${JSON.stringify(f)}`).toBe(totals.get(key) ?? 0);
            all += sum;
            checked += lines.length;
          }
          expect(all).toBe(total(totals));
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  it('a mãe inclui a subcategoria e as linhas dizem qual é; estorno é linha negativa', async () => {
    const lines = await categoryLines(db, 'bruto', ...month('2026-10-01'), cat['Mercado']!);
    expect(lines.map((l) => l.description).sort()).toEqual(['Feira', 'Padaria', 'TV']);
    expect(lines.find((l) => l.description === 'Feira')!.categoryId).toBe(horti);
    expect(lines.find((l) => l.description === 'Padaria')!.categoryId).toBe(cat['Mercado']);
    const nov = await categoryLines(db, 'bruto', ...month('2026-11-01'), cat['Mercado']!);
    expect(nov).toHaveLength(1);
    expect(nov[0]).toMatchObject({ amountCents: -3_000, description: 'Estorno: TV' });
    // no Mensal, a compra em 12x vira a parcela da fatura que vence no mês
    const mensal = await categoryLines(db, 'mensal', ...month('2026-11-01'), cat['Mercado']!);
    expect(mensal.some((l) => l.description.startsWith('TV') && l.amountCents === 10_000)).toBe(true);
  });
});

describe('trocar a categoria', () => {
  it('compra no cartão: o plano inteiro muda (todas as parcelas), o total do mês não', async () => {
    const txId = (
      await q<{ transaction_id: string }>(`select transaction_id from installment_plans where id = $1`, [
        planId,
      ])
    )[0]!.transaction_id;
    const [from, to] = month('2026-10-01');
    const before = total(await grossSpend(db, from, to, 'category'));
    const r = await setTransactionCategory(ctx, txId, {
      categoryId: cat['Compras']!,
      version: await versionOf(txId),
    });
    expect(r.changed).toBe(1);
    expect(await categoryOf(txId)).toBe(cat['Compras']);
    expect(total(await grossSpend(db, from, to, 'category'))).toBe(before);
    const gross = await grossSpend(db, from, to, 'category');
    expect(gross.get(cat['Compras']!)).toBe(120_000);
    // no Mensal, as parcelas seguem a categoria nova e o estorno acompanha a compra (D42)
    const nov = await monthlySpend(db, ...month('2026-12-01'), 'category');
    expect(nov.get(cat['Compras']!)).toBe(10_000 - 3_000);
    const [log] = await q<{ before: { categoryId: string }; after: { categoryId: string } }>(
      `select before, after from audit_log where entity = 'transactions' and entity_id = $1 and action = 'UPDATE'`,
      [txId],
    );
    expect(log!.before.categoryId).toBe(cat['Mercado']);
    expect(log!.after.categoryId).toBe(cat['Compras']);
  });

  it('vale com a fatura fechada, e o valor continua travado (só a categoria muda)', async () => {
    const txId = (
      await q<{ transaction_id: string }>(`select transaction_id from installment_plans where id = $1`, [
        planId,
      ])
    )[0]!.transaction_id;
    await q(
      `update invoices set closing_date = '2026-01-01' where id in (select first_invoice_id from installment_plans where id = $1)`,
      [planId],
    );
    await setTransactionCategory(ctx, txId, { categoryId: cat['Lazer']!, version: await versionOf(txId) });
    expect(await categoryOf(txId)).toBe(cat['Lazer']);
    expect(
      (
        await q<{ amount_cents: string }>(`select amount_cents::text from transactions where id = $1`, [txId])
      )[0]!.amount_cents,
    ).toBe('120000');
  });

  it('recusa versão velha, categoria de outro tipo, arquivada ou inexistente', async () => {
    const v = await versionOf(feiraId);
    await expect(
      setTransactionCategory(ctx, feiraId, { categoryId: cat['Lazer']!, version: v + 5 }),
    ).rejects.toThrow('alterado por outra pessoa');
    await expect(
      setTransactionCategory(ctx, feiraId, { categoryId: cat['Salário CLT']!, version: v }),
    ).rejects.toThrow('categoria de despesa');
    await q(`update categories set archived_at = now() where id = $1`, [cat['Lazer']]);
    await expect(
      setTransactionCategory(ctx, feiraId, { categoryId: cat['Lazer']!, version: v }),
    ).rejects.toThrow('Categoria não encontrada');
    expect(await categoryOf(feiraId)).toBe(horti); // nada mudou
  });

  it('para a mesma categoria não faz nada; trocar a versão sobe a cada troca', async () => {
    const v = await versionOf(feiraId);
    expect((await setTransactionCategory(ctx, feiraId, { categoryId: horti, version: v })).changed).toBe(0);
    expect(await versionOf(feiraId)).toBe(v);
    await setTransactionCategory(ctx, feiraId, { categoryId: cat['Mercado']!, version: v });
    expect(await versionOf(feiraId)).toBe(v + 1);
  });

  it('empréstimo (parcela e valor recebido) é bloqueado', async () => {
    await createLoan(ctx, {
      name: 'Pessoal',
      lender: null,
      principal: 100_000,
      total: 120_000,
      installments: 3,
      receivedDate: '2026-10-10',
      firstDueDate: '2026-11-10',
      notes: null,
    });
    const rows = await q<{ id: string; version: number }>(
      `select id, version from transactions where loan_id is not null`,
    );
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows)
      await expect(
        setTransactionCategory(ctx, r.id, { categoryId: cat['Lazer']!, version: r.version }),
      ).rejects.toThrow('empréstimo');
  });

  it('pagamento antecipado: trocar o pagamento troca também a conta original, e vice-versa', async () => {
    const t = { ...ctx, today: '2026-10-30' };
    const { id: parentId } = await createEntry(t, {
      kind: 'EXPENSE',
      amount: 21_780,
      description: 'Parcela Shopee',
      categoryId: cat['Contas da casa']!,
      paymentMethod: 'PIX',
      date: '2026-11-01',
      beneficiaryUserId: null,
      notes: null,
      paid: false,
    });
    const { id: paymentId } = await confirmPayment(t, parentId, await versionOf(parentId), {
      amount: 21_000,
      date: '2026-10-30',
    });
    expect(
      (await q<{ status: string }>(`select status from transactions where id = $1`, [parentId]))[0]!.status,
    ).toBe('ANTICIPATED');

    const r = await setTransactionCategory(t, paymentId, {
      categoryId: cat['Compras']!,
      version: await versionOf(paymentId),
    });
    expect(r.changed).toBe(2);
    expect(await categoryOf(parentId)).toBe(cat['Compras']);
    expect(await categoryOf(paymentId)).toBe(cat['Compras']);

    // pela conta original (ANTICIPATED) também
    await setTransactionCategory(t, parentId, {
      categoryId: cat['Lazer']!,
      version: await versionOf(parentId),
    });
    expect(await categoryOf(paymentId)).toBe(cat['Lazer']);
  });

  describe('lançamento gerado por um fixo', () => {
    const occurrences = async () =>
      q<{ id: string; month: string; status: string; category_id: string; version: number }>(
        `select id, occurrence_month::text as month, status, category_id, version from transactions
         where recurring_template_id is not null and deleted_at is null order by occurrence_month`,
      );

    beforeEach(async () => {
      await generateOccurrences(db, '2026-12-20');
    });

    it('"só este" muda apenas a ocorrência', async () => {
      const [oct, nov, dec] = await occurrences();
      expect(dec).toBeDefined();
      await setTransactionCategory(ctx, nov!.id, {
        categoryId: cat['Casa e manutenção']!,
        version: nov!.version,
        scope: 'THIS',
      });
      const after = await occurrences();
      expect(after.map((o) => o.category_id)).toEqual([
        oct!.category_id,
        cat['Casa e manutenção'],
        dec!.category_id,
      ]);
      expect(
        (await q<{ category_id: string }>(`select category_id from recurring_templates`))[0]!.category_id,
      ).toBe(cat['Moradia']);
    });

    it('"este e os próximos" muda o fixo e as pendentes dali em diante; as anteriores e as pagas ficam', async () => {
      const [oct, nov, dec] = await occurrences();
      // outubro já pago: continua em Moradia
      await confirmPayment({ ...ctx, today: '2026-10-17' }, oct!.id, oct!.version, {
        amount: 200_000,
        date: '2026-10-17',
      });
      const r = await setTransactionCategory(ctx, nov!.id, {
        categoryId: cat['Casa e manutenção']!,
        version: nov!.version,
        scope: 'THIS_AND_FUTURE',
      });
      expect(r.changed).toBe(2); // novembro e dezembro
      const after = await occurrences();
      expect(after.map((o) => o.category_id)).toEqual([
        cat['Moradia'],
        cat['Casa e manutenção'],
        cat['Casa e manutenção'],
      ]);
      expect(
        (await q<{ category_id: string }>(`select category_id from recurring_templates`))[0]!.category_id,
      ).toBe(cat['Casa e manutenção']);
      expect(dec).toBeDefined();
      // as próximas ocorrências geradas já nascem na categoria nova
      await generateOccurrences(db, '2027-02-20');
      const later = (await occurrences()).filter((o) => o.month >= '2027-01-01');
      expect(later.length).toBeGreaterThan(0);
      expect(later.every((o) => o.category_id === cat['Casa e manutenção'])).toBe(true);
    });

    it('"este e os próximos" num lançamento que não vem de um fixo é recusado', async () => {
      await expect(
        setTransactionCategory(ctx, feiraId, {
          categoryId: cat['Lazer']!,
          version: await versionOf(feiraId),
          scope: 'THIS_AND_FUTURE',
        }),
      ).rejects.toThrow('não vem de um lançamento fixo');
      expect(await categoryOf(feiraId)).toBe(horti); // a troca também foi desfeita (tudo ou nada)
    });
  });
});
