/**
 * Orçamentos (D79), contra Postgres real (PGlite): o gasto de cada orçamento é EXATAMENTE o Gasto Mensal canônico
 * (categoria-mãe com as subcategorias; teto = tudo), o valor "a partir de" um mês não mexe nos meses anteriores,
 * parar de acompanhar guarda o histórico, e as regras de categoria são validadas antes do banco.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { budgetHistory, budgetMonthView, getBudgetRecord } from '@/db/queries/budgets';
import { monthlySpend, total } from '@/db/queries/reports';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { setBudget, stopBudget } from '@/server/budgets';
import { createCardPurchase } from '@/server/card-purchases';
import { createCard } from '@/server/cards';
import { createCategory, setCategoryArchived } from '@/server/categories';
import type { ServiceCtx } from '@/server/context';
import { createEntry } from '@/server/entries';
import { freshDb } from './helpers';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let horti: string;
const cat: Record<string, string> = {};

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;
const OCT = '2026-10-01';
const NOV = '2026-11-01';
const DEC = '2026-12-01';

const expense = (amount: number, categoryId: string, date: string, description = 'Gasto') =>
  createEntry(ctx, {
    kind: 'EXPENSE',
    amount,
    description,
    categoryId,
    paymentMethod: 'PIX',
    date,
    notes: null,
    beneficiaryUserId: null,
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
  for (const r of await q<{ id: string; name: string }>(`select id, name from categories`))
    cat[r.name] = r.id;
  const eduardo = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId: eduardo, today: '2026-10-17' };
  horti = (
    await createCategory(ctx, { kind: 'EXPENSE', name: 'Hortifruti', aliases: [], parentId: cat['Mercado']! })
  ).id;

  await expense(10_000, horti, '2026-10-05', 'Feira'); // subcategoria soma na mãe
  await expense(4_000, cat['Mercado']!, '2026-10-06', 'Padaria');
  await expense(5_000, cat['Lazer']!, '2026-10-07', 'Cinema');
  const card = (
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
  // 12x de R$ 100,00: fatura que fecha em 03/11 e vence em 10/11 → no Gasto Mensal a partir de novembro
  await createCardPurchase(ctx, {
    cardId: card,
    amount: 120_000,
    installments: 12,
    description: 'TV',
    categoryId: cat['Mercado']!,
    date: '2026-10-16',
    beneficiaryUserId: null,
    notes: null,
  });
});

describe('o gasto do orçamento é o Gasto Mensal canônico', () => {
  it('categoria-mãe soma as subcategorias; teto soma tudo; o resto é "sem orçamento"', async () => {
    await setBudget(ctx, { categoryId: cat['Mercado']!, amount: 15_000, fromMonth: OCT });
    await setBudget(ctx, { categoryId: null, amount: 30_000, fromMonth: OCT });

    for (const m of [OCT, NOV, DEC]) {
      const canonical = await monthlySpend(db, m, `${m.slice(0, 8)}${m === NOV ? '30' : '31'}`, 'category');
      const view = await budgetMonthView(db, m);
      expect(view.lines.find((l) => l.categoryId === cat['Mercado'])!.spentCents).toBe(
        canonical.get(cat['Mercado']!) ?? 0,
      );
      expect(view.cap!.spentCents).toBe(total(canonical));
      expect(view.totalSpentCents).toBe(total(canonical));
      expect(view.unbudgetedCents).toBe(total(canonical) - (canonical.get(cat['Mercado']!) ?? 0));
    }

    const oct = await budgetMonthView(db, OCT);
    const mercado = oct.lines[0]!;
    expect(mercado).toMatchObject({
      name: 'Mercado',
      spentCents: 14_000,
      limitCents: 15_000,
      level: 'warning',
    });
    expect(mercado.percent).toBe(93);
    expect(mercado.remainingCents).toBe(1_000);
    expect(oct.cap).toMatchObject({ name: 'Teto do mês', spentCents: 19_000, level: 'ok', percent: 63 });
    expect(oct.unbudgetedCents).toBe(5_000);
    expect(oct.alerts.map((a) => a.name)).toEqual(['Mercado']);

    // novembro: só a parcela da TV (R$ 100,00) no Mercado
    const nov = await budgetMonthView(db, NOV);
    expect(nov.lines[0]).toMatchObject({ spentCents: 10_000, level: 'ok', percent: 66 });
  });

  it('passou do limite: alerta primeiro, com o quanto passou', async () => {
    await setBudget(ctx, { categoryId: cat['Mercado']!, amount: 50_000, fromMonth: OCT });
    await setBudget(ctx, { categoryId: cat['Lazer']!, amount: 3_000, fromMonth: OCT });
    const oct = await budgetMonthView(db, OCT);
    expect(oct.lines.map((l) => [l.name, l.level])).toEqual([
      ['Lazer', 'over'],
      ['Mercado', 'ok'],
    ]);
    expect(oct.alerts).toHaveLength(1);
    expect(oct.alerts[0]).toMatchObject({ name: 'Lazer', remainingCents: -2_000, percent: 166 });
    expect(oct.cap).toBeNull(); // sem teto cadastrado
  });

  it('o histórico traz o gasto e o orçamento de cada mês', async () => {
    const { id } = await setBudget(ctx, { categoryId: cat['Mercado']!, amount: 15_000, fromMonth: NOV });
    const record = (await getBudgetRecord(db, id))!;
    const points = await budgetHistory(db, record, DEC, 3);
    expect(points).toEqual([
      { month: OCT, label: 'out/26', spentCents: 14_000, limitCents: null, level: null },
      { month: NOV, label: 'nov/26', spentCents: 10_000, limitCents: 15_000, level: 'ok' },
      { month: DEC, label: 'dez/26', spentCents: 10_000, limitCents: 15_000, level: 'ok' },
    ]);
  });
});

describe('valor a partir de um mês', () => {
  it('mudar o valor não mexe nos meses anteriores; mudar antes apaga as mudanças seguintes', async () => {
    const { id } = await setBudget(ctx, { categoryId: cat['Mercado']!, amount: 15_000, fromMonth: OCT });
    const again = await setBudget(ctx, { categoryId: cat['Mercado']!, amount: 20_000, fromMonth: DEC });
    expect(again.id).toBe(id); // um orçamento por categoria
    const limit = async (m: string) => (await budgetMonthView(db, m)).lines[0]?.limitCents ?? null;
    expect([await limit(OCT), await limit(NOV), await limit(DEC)]).toEqual([15_000, 15_000, 20_000]);

    await setBudget(ctx, { categoryId: cat['Mercado']!, amount: 12_000, fromMonth: NOV });
    expect([await limit(OCT), await limit(NOV), await limit(DEC)]).toEqual([15_000, 12_000, 12_000]);

    const audits = await q<{ action: string }>(
      `select action from audit_log where entity = 'budgets' and entity_id = $1 order by id`,
      [id],
    );
    expect(audits.map((a) => a.action)).toEqual(['CREATE', 'CHANGE_FROM', 'CHANGE_FROM']);
  });

  it('parar de acompanhar guarda os meses anteriores; voltar reaproveita o mesmo orçamento', async () => {
    const { id } = await setBudget(ctx, { categoryId: null, amount: 30_000, fromMonth: OCT });
    await stopBudget(ctx, id, NOV);
    expect((await budgetMonthView(db, OCT)).cap?.limitCents).toBe(30_000);
    expect((await budgetMonthView(db, NOV)).cap).toBeNull();
    expect((await budgetMonthView(db, DEC)).cap).toBeNull();
    await expect(stopBudget(ctx, id, DEC)).rejects.toThrow('já não vale em dezembro de 2026');

    const back = await setBudget(ctx, { categoryId: null, amount: 25_000, fromMonth: DEC });
    expect(back.id).toBe(id);
    expect((await budgetMonthView(db, NOV)).cap).toBeNull();
    expect((await budgetMonthView(db, DEC)).cap?.limitCents).toBe(25_000);
  });
});

describe('validação (antes do banco)', () => {
  it('só categoria-mãe de despesa e ativa', async () => {
    await expect(setBudget(ctx, { categoryId: horti, amount: 1_000, fromMonth: OCT })).rejects.toThrow(
      'o orçamento soma as subcategorias',
    );
    await expect(
      setBudget(ctx, { categoryId: cat['Salário CLT']!, amount: 1_000, fromMonth: OCT }),
    ).rejects.toThrow('só para categorias de despesa');
    await setCategoryArchived(ctx, cat['Lazer']!, true);
    await expect(
      setBudget(ctx, { categoryId: cat['Lazer']!, amount: 1_000, fromMonth: OCT }),
    ).rejects.toThrow('Categoria não encontrada');
    expect(await q(`select 1 from budgets`)).toHaveLength(0);
  });

  it('constraints: valor positivo e mês no dia 1', async () => {
    const { id } = await setBudget(ctx, { categoryId: null, amount: 1_000, fromMonth: OCT });
    await expect(
      q(`insert into budget_amounts (budget_id, start_month, amount_cents) values ($1, '2027-01-01', 0)`, [
        id,
      ]),
    ).rejects.toThrow();
    await expect(
      q(`insert into budget_amounts (budget_id, start_month, amount_cents) values ($1, '2027-01-15', 100)`, [
        id,
      ]),
    ).rejects.toThrow();
    await expect(q(`insert into budgets (created_by_user_id) values ($1)`, [ctx.userId])).rejects.toThrow(); // um teto só
  });
});
