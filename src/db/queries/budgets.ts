/**
 * Orçamentos (D79): o gasto de cada orçamento é o Gasto Mensal (fórmula canônica, `monthlySpend`) da categoria-mãe
 * (com as subcategorias) ou, no teto do mês, de tudo. Nada disso é armazenado: só o valor do orçamento por mês.
 */
import { asc, eq } from 'drizzle-orm';
import { amountForMonth, budgetStatus, type BudgetAmount, type BudgetStatus } from '@/domain/budgets/budgets';
import { addMonths, formatMonthShort, monthEnd, monthStart, type ISODate } from '@/domain/dates';
import type { Cents } from '@/domain/money';
import type { AnyDB } from '../client';
import { budgetAmounts, budgets, categories } from '../schema';
import { monthlySpend, total } from './reports';

export const CAP_NAME = 'Teto do mês';

export type BudgetRecord = {
  id: string;
  /** null = teto do mês */
  categoryId: string | null;
  name: string;
  icon: string | null;
  archived: boolean;
  amounts: BudgetAmount[];
};

/** Todos os orçamentos com as linhas de valor (teto primeiro, depois por nome). */
export async function listBudgetRecords(db: AnyDB): Promise<BudgetRecord[]> {
  const [list, rows] = await Promise.all([
    db
      .select({
        id: budgets.id,
        categoryId: budgets.categoryId,
        name: categories.name,
        icon: categories.icon,
        archivedAt: categories.archivedAt,
      })
      .from(budgets)
      .leftJoin(categories, eq(categories.id, budgets.categoryId)),
    db
      .select({
        budgetId: budgetAmounts.budgetId,
        startMonth: budgetAmounts.startMonth,
        amountCents: budgetAmounts.amountCents,
      })
      .from(budgetAmounts)
      .orderBy(asc(budgetAmounts.startMonth)),
  ]);
  return list
    .map((b) => ({
      id: b.id,
      categoryId: b.categoryId,
      name: b.categoryId ? (b.name ?? 'Categoria') : CAP_NAME,
      icon: b.icon,
      archived: b.archivedAt !== null,
      amounts: rows
        .filter((r) => r.budgetId === b.id)
        .map((r) => ({ startMonth: r.startMonth, amountCents: r.amountCents })),
    }))
    .sort((a, b) =>
      a.categoryId === null ? -1 : b.categoryId === null ? 1 : a.name.localeCompare(b.name, 'pt-BR'),
    );
}

export type BudgetLine = BudgetStatus & {
  id: string;
  categoryId: string | null;
  name: string;
  icon: string | null;
  limitCents: Cents;
  spentCents: Cents;
};

export type BudgetMonthView = {
  month: ISODate;
  /** teto do mês, se houver neste mês */
  cap: BudgetLine | null;
  /** orçamentos por categoria que valem no mês, do mais estourado para o mais folgado */
  lines: BudgetLine[];
  /** passaram do limite ou estão perto (teto incluído) */
  alerts: BudgetLine[];
  /** Gasto Mensal total do mês */
  totalSpentCents: Cents;
  /** Gasto Mensal das categorias sem orçamento no mês (com ajustes de fatura e sem categoria) */
  unbudgetedCents: Cents;
};

const line = (b: BudgetRecord, limitCents: Cents, spentCents: Cents): BudgetLine => ({
  id: b.id,
  categoryId: b.categoryId,
  name: b.name,
  icon: b.icon,
  limitCents,
  spentCents,
  ...budgetStatus(spentCents, limitCents),
});

const ORDER = { over: 0, warning: 1, ok: 2 } as const;

/** Os orçamentos do mês com o gasto (Gasto Mensal) de cada um e os alertas. */
export async function budgetMonthView(db: AnyDB, month: ISODate): Promise<BudgetMonthView> {
  const m = monthStart(month);
  const [records, spend] = await Promise.all([
    listBudgetRecords(db),
    monthlySpend(db, m, monthEnd(m), 'category'),
  ]);
  const totalSpentCents = total(spend);
  let cap: BudgetLine | null = null;
  const lines: BudgetLine[] = [];
  for (const b of records) {
    const limit = amountForMonth(b.amounts, m);
    if (limit === null) continue;
    if (b.categoryId === null) cap = line(b, limit, totalSpentCents);
    else lines.push(line(b, limit, spend.get(b.categoryId) ?? 0));
  }
  lines.sort((a, b) => ORDER[a.level] - ORDER[b.level] || b.percent - a.percent);
  const budgeted = new Set(lines.map((l) => l.categoryId));
  const unbudgetedCents = [...spend].reduce((s, [k, v]) => (budgeted.has(k) ? s : s + v), 0);
  const alerts = [...(cap && cap.level !== 'ok' ? [cap] : []), ...lines.filter((l) => l.level !== 'ok')];
  return { month: m, cap, lines, alerts, totalSpentCents, unbudgetedCents };
}

export type BudgetHistoryPoint = {
  month: ISODate;
  label: string;
  spentCents: Cents;
  /** null = não tinha orçamento nesse mês */
  limitCents: Cents | null;
  level: BudgetStatus['level'] | null;
};

/** Os últimos `count` meses até `month`: gasto (Gasto Mensal) × orçamento de cada mês. */
export async function budgetHistory(
  db: AnyDB,
  b: BudgetRecord,
  month: ISODate,
  count = 6,
): Promise<BudgetHistoryPoint[]> {
  const last = monthStart(month);
  const first = addMonths(last, -(count - 1));
  const byMonth = await monthlySpend(
    db,
    first,
    monthEnd(last),
    'month',
    b.categoryId ? { categoryId: b.categoryId } : {},
  );
  return Array.from({ length: count }, (_, i) => {
    const m = addMonths(first, i);
    const spentCents = byMonth.get(m) ?? 0;
    const limitCents = amountForMonth(b.amounts, m);
    return {
      month: m,
      label: formatMonthShort(m),
      spentCents,
      limitCents,
      level: limitCents === null ? null : budgetStatus(spentCents, limitCents).level,
    };
  });
}

export async function getBudgetRecord(db: AnyDB, id: string): Promise<BudgetRecord | null> {
  return (await listBudgetRecords(db)).find((b) => b.id === id) ?? null;
}
