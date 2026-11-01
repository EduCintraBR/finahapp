import { compareDates, diffDays, formatDateBR, monthEnd, monthStart, type ISODate } from '../dates';

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

/** Destaque de pendente: vencida (passou do vencimento), vence hoje, ou vence em até 3 dias. */
export function dueHighlight(dueDate: ISODate, today: ISODate): DueHighlight | null {
  const days = diffDays(dueDate, today);
  if (days < 0) return 'OVERDUE';
  if (days === 0) return 'TODAY';
  return days <= 3 ? 'SOON' : null;
}

export const DUE_HIGHLIGHT_LABEL: Record<DueHighlight, string> = {
  OVERDUE: 'Vencida',
  TODAY: 'Vence hoje',
  SOON: 'Vence em até 3 dias',
};

/**
 * Lançamento agendado (D67): já registrado como pago, mas com data DEPOIS de hoje. Ele só passa a valer no saldo
 * da conta no dia: até lá é "a receber"/"a pagar", sem precisar dar baixa (entra sozinho quando a data chega).
 */
export function isScheduled(e: { status: string; postedDate: ISODate | null }, today: ISODate): boolean {
  return e.status === 'POSTED' && e.postedDate !== null && compareDates(e.postedDate, today) > 0;
}

/**
 * D72: a partir de que data um pendente é "atrasado que veio de antes" para o mês: o menor entre o início do mês e
 * hoje. Em mês futuro, o que vence entre hoje e o fim do mês atual ainda não atrasou, então fica no mês dele.
 */
export function overdueCutoff(month: ISODate, today: ISODate): ISODate {
  const from = monthStart(month);
  return compareDates(today, from) < 0 ? today : from;
}

/**
 * D72 (U4a): um pendente (conta, receita prevista ou fatura) conta no A pagar/A receber (e nas Saídas) do mês em
 * que vence e, enquanto não for pago ou recebido, também nos meses seguintes. Ao dar baixa, sai de todos eles.
 */
export function pendingCountsInMonth(dueDate: ISODate, month: ISODate, today: ISODate): boolean {
  if (compareDates(dueDate, monthEnd(month)) > 0) return false;
  return (
    compareDates(dueDate, monthStart(month)) >= 0 || compareDates(dueDate, overdueCutoff(month, today)) < 0
  );
}

/**
 * Aporte exigido (D69): quanto falta no saldo da conta (na data do pagamento) para pagar `amountCents` sem ficar
 * negativo. Se o saldo já está negativo, o aporte tem que cobrir o buraco também. 0 = o saldo basta.
 */
export function fundingNeeded(balanceCents: number, amountCents: number): number {
  return Math.max(0, amountCents - balanceCents);
}
