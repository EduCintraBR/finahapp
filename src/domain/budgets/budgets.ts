/**
 * Orçamentos (D79): limite de Gasto Mensal por categoria e teto do mês. Regras puras: o gasto vem de fora (fórmula
 * canônica do Gasto Mensal) e nunca é armazenado. Meses são 'YYYY-MM-01' (comparáveis como texto).
 */
import type { ISODate } from '../dates';
import type { Cents } from '../money';

/** A partir de quantos % do limite o orçamento fica "perto do limite". */
export const WARNING_PERCENT = 80;

/** Linha de valor: vale do mês `startMonth` até a próxima; `null` = sem orçamento a partir dela. */
export type BudgetAmount = { startMonth: ISODate; amountCents: Cents | null };

/** Valor do orçamento no mês, ou null (ainda não começou ou parou de acompanhar). */
export function amountForMonth(rows: readonly BudgetAmount[], month: ISODate): Cents | null {
  let best: BudgetAmount | undefined;
  for (const r of rows) {
    if (r.startMonth <= month && (!best || r.startMonth > best.startMonth)) best = r;
  }
  return best?.amountCents ?? null;
}

/**
 * Linhas depois de mudar o valor "a partir de" `from`: as anteriores ficam, a do mês passa a ser `amount` e as
 * seguintes saem (o novo valor vale dali em diante). `amount = null` para de acompanhar a partir do mês.
 */
export function nextAmounts(
  rows: readonly BudgetAmount[],
  from: ISODate,
  amount: Cents | null,
): BudgetAmount[] {
  return [
    ...rows.filter((r) => r.startMonth < from).sort((a, b) => (a.startMonth < b.startMonth ? -1 : 1)),
    { startMonth: from, amountCents: amount },
  ];
}

export type BudgetLevel = 'ok' | 'warning' | 'over';

export type BudgetStatus = {
  level: BudgetLevel;
  /** % do limite já gasto, arredondado para baixo (só exibição) */
  percent: number;
  /** limite − gasto; negativo = quanto passou */
  remainingCents: Cents;
};

/**
 * Situação do orçamento: ok (< 80%), perto do limite (de 80% até o limite) e passou (acima do limite).
 * Comparações em centavos inteiros, sem divisão.
 */
export function budgetStatus(spentCents: Cents, limitCents: Cents): BudgetStatus {
  const spent = Math.max(spentCents, 0);
  const level: BudgetLevel =
    spent > limitCents ? 'over' : spent * 100 >= limitCents * WARNING_PERCENT ? 'warning' : 'ok';
  return {
    level,
    percent: limitCents > 0 ? Math.floor((spent * 100) / limitCents) : 0,
    remainingCents: limitCents - spentCents,
  };
}
