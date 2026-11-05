import type { Cents } from './money';

/**
 * Total a pagar da lista de Pendentes da Início: a soma, em centavos, das saídas (EXPENSE) pendentes. Entradas
 * pendentes (a receber) aparecem na lista, mas não são dívida, então não entram.
 */
export function pendingPayableCents(entries: ReadonlyArray<{ kind: string; amountCents: Cents }>): Cents {
  return entries.reduce((sum, e) => (e.kind === 'EXPENSE' ? sum + e.amountCents : sum), 0);
}
