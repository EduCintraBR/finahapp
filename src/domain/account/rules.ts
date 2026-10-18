import { compareDates, diffDays, formatDateBR, type ISODate } from '../dates';

/**
 * D18: nada na conta pode ter data anterior ao saldo inicial — o saldo inicial já
 * reflete tudo o que aconteceu antes, então contaria duas vezes.
 * Devolve a mensagem de erro (pt-BR) ou null.
 */
export function checkNotBeforeOpening(date: ISODate, openingBalanceDate: ISODate): string | null {
  return compareDates(date, openingBalanceDate) < 0
    ? `A data não pode ser anterior ao início do controle (${formatDateBR(openingBalanceDate)}).`
    : null;
}

export type DueHighlight = 'OVERDUE' | 'TODAY' | 'SOON';

/** Destaque de pendente: atrasado (venceu), vence hoje, ou vence em até 3 dias. */
export function dueHighlight(dueDate: ISODate, today: ISODate): DueHighlight | null {
  const days = diffDays(dueDate, today);
  if (days < 0) return 'OVERDUE';
  if (days === 0) return 'TODAY';
  return days <= 3 ? 'SOON' : null;
}

export const DUE_HIGHLIGHT_LABEL: Record<DueHighlight, string> = {
  OVERDUE: 'Atrasado',
  TODAY: 'Vence hoje',
  SOON: 'Vence em até 3 dias',
};
