import { compareDates, monthStart, type ISODate } from '../dates';

/**
 * Pagamento antecipado (D70): a conta vence num mês e foi paga num mês ANTERIOR. Dentro do mesmo mês (adiantar
 * ou atrasar alguns dias) a baixa segue como sempre: o mês de quem manda é o mesmo.
 */
export function isEarlyPayment(dueDate: ISODate, paymentDate: ISODate): boolean {
  return compareDates(monthStart(paymentDate), monthStart(dueDate)) < 0;
}

/** Diferença entre o previsto e o pago: desconto (pagou menos) ou acréscimo (juros/multa, pagou mais). */
export function paymentAdjustment(
  scheduledCents: number,
  paidCents: number,
): { discountCents: number; surchargeCents: number } {
  const diff = scheduledCents - paidCents;
  return { discountCents: Math.max(0, diff), surchargeCents: Math.max(0, -diff) };
}
