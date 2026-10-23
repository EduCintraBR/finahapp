/**
 * Empréstimo (D66): parcelas, rateio do pagamento de várias parcelas de uma vez e resumo. Regras puras, sem banco.
 * O usuário informa só o valor TOTAL a pagar (já com juros); o app divide em parcelas mensais.
 * Dinheiro sempre em centavos inteiros; o resto do arredondamento vai na 1ª parcela (invariante 4).
 */
import { addMonths, compareDates, type ISODate } from '../dates';
import type { Cents } from '../money';

export const MAX_LOAN_INSTALLMENTS = 120;

export type LoanInstallmentPlan = { number: number; amountCents: Cents; dueDate: ISODate };

/** Parcelas mensais a partir do vencimento da 1ª. Dia que não existe no mês (31) cai no último dia do mês. */
export function buildLoanInstallments(
  totalCents: Cents,
  count: number,
  firstDueDate: ISODate,
): LoanInstallmentPlan[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_LOAN_INSTALLMENTS) {
    throw new Error(`Número de parcelas: de 1 a ${MAX_LOAN_INSTALLMENTS}.`);
  }
  if (!Number.isInteger(totalCents) || totalCents < count) {
    throw new Error('Cada parcela precisa ter pelo menos R$ 0,01.');
  }
  // o splitInstallments do cartão vai até 72 parcelas; aqui até 120, com a mesma regra (resto todo na 1ª)
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    amountCents: i === 0 ? base + remainder : base,
    // sempre a partir do vencimento da 1ª: 31/jan → 28/fev → 31/mar (e não 28 em diante)
    dueDate: addMonths(firstDueDate, i),
  }));
}

/**
 * Rateia o valor pago de uma vez entre as parcelas escolhidas, proporcional ao valor de cada uma. Cada parcela
 * fica com pelo menos R$ 0,01, a soma é exatamente o valor pago e o resto vai na 1ª. Vale também para pagar mais
 * que o programado (atraso, multa).
 */
export function allocatePayment(scheduledCents: readonly Cents[], paidCents: Cents): Cents[] {
  const n = scheduledCents.length;
  if (n === 0) throw new Error('Escolha pelo menos uma parcela.');
  if (!Number.isInteger(paidCents) || paidCents <= 0)
    throw new Error('O valor pago precisa ser maior que zero.');
  if (paidCents < n) throw new Error('Cada parcela precisa receber pelo menos R$ 0,01.');
  const totalScheduled = scheduledCents.reduce((s, v) => s + BigInt(v), 0n);
  // BigInt: valor × valor passa de 2^53 em empréstimos grandes
  const proportional = (amount: number, floor: number) =>
    scheduledCents.map((s) => floor + Number((BigInt(amount) * BigInt(s)) / totalScheduled));
  let shares = proportional(paidCents, 0);
  // valor muito baixo para o rateio proporcional: garante 1 centavo por parcela e rateia o resto
  if (shares.some((v) => v < 1)) shares = proportional(paidCents - n, 1);
  shares[0] = shares[0]! + (paidCents - shares.reduce((s, v) => s + v, 0)); // o resto vai na 1ª
  return shares;
}

export type LoanInstallmentState = {
  number: number;
  scheduledCents: Cents;
  /** valor realmente pago (parcela baixada) ou null se ainda pendente */
  paidCents: Cents | null;
  dueDate: ISODate;
  paidDate: ISODate | null;
};

export type LoanSummary = {
  totalScheduledCents: Cents;
  paidCents: Cents;
  paidCount: number;
  /** o que falta pagar, pelo valor programado */
  remainingCents: Cents;
  /** Σ (programado − pago) das parcelas pagas abaixo do programado (adiantamento com desconto) */
  savingsCents: Cents;
  /** Σ (pago − programado) das parcelas pagas acima do programado (atraso, multa) */
  lateFeesCents: Cents;
  overdueCount: number;
  nextDueDate: ISODate | null;
  settled: boolean;
};

export function summarizeLoan(installments: readonly LoanInstallmentState[], today: ISODate): LoanSummary {
  let totalScheduled = 0;
  let paid = 0;
  let paidCount = 0;
  let remaining = 0;
  let savings = 0;
  let lateFees = 0;
  let overdue = 0;
  let next: ISODate | null = null;
  for (const i of installments) {
    totalScheduled += i.scheduledCents;
    if (i.paidCents === null) {
      remaining += i.scheduledCents;
      if (compareDates(i.dueDate, today) < 0) overdue++;
      if (next === null || compareDates(i.dueDate, next) < 0) next = i.dueDate;
    } else {
      paid += i.paidCents;
      paidCount++;
      if (i.paidCents < i.scheduledCents) savings += i.scheduledCents - i.paidCents;
      else lateFees += i.paidCents - i.scheduledCents;
    }
  }
  return {
    totalScheduledCents: totalScheduled,
    paidCents: paid,
    paidCount,
    remainingCents: remaining,
    savingsCents: savings,
    lateFeesCents: lateFees,
    overdueCount: overdue,
    nextDueDate: next,
    settled: installments.length > 0 && paidCount === installments.length,
  };
}
