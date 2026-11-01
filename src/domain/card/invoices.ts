/**
 * Faturas: datas geradas pela regra do cartão (D29), alocação de compras (invariante 5),
 * situação derivada (D30) e limite (fórmula canônica).
 */
import { addDays, addMonths, compareDates, dateInMonth, monthStart, type ISODate } from '../dates';
import { assertCents, type Cents } from '../money';

/**
 * Cartão: dia do fechamento e dia do vencimento (D29). Crediário (D73): vencimento no `dueDay` (o dia da 1ª
 * fatura do ciclo) e fechamento `closeBeforeDays` dias antes do vencimento.
 */
export type InvoiceRule =
  { closingDay: number; dueDay: number } | { dueDay: number; closeBeforeDays: number };
export type InvoiceWindow = { referenceMonth: ISODate; closingDate: ISODate; dueDate: ISODate };

/** Os campos do cadastro que definem as datas das faturas (cartão ou crediário). */
export type CardTerms = {
  kind: 'CARD' | 'STORE_CREDIT';
  closingDay: number | null;
  dueDay: number;
  closeBeforeDays: number | null;
  firstDueDays: number | null;
};

/** Regra das faturas do cadastro. No crediário vale para o ciclo atual (dia do vencimento em `dueDay`). */
export function cardRule(c: CardTerms): InvoiceRule {
  if (c.kind === 'STORE_CREDIT') {
    if (c.closeBeforeDays === null) throw new Error('Crediário sem dias de fechamento.');
    return { dueDay: c.dueDay, closeBeforeDays: c.closeBeforeDays };
  }
  if (c.closingDay === null) throw new Error('Cartão sem dia de fechamento.');
  return { closingDay: c.closingDay, dueDay: c.dueDay };
}

/**
 * Fatura que vence no mês `referenceMonth` (D29): vencimento no `dueDay` desse mês;
 * fechamento no `closingDay` do mesmo mês se closingDay < dueDay, senão do mês anterior.
 * Dia inexistente → último dia do mês. Se o ajuste fizer o fechamento colar no vencimento,
 * o fechamento fica um dia antes. No crediário, o fechamento é o vencimento − `closeBeforeDays`.
 */
export function ruleInvoice(referenceMonth: ISODate, rule: InvoiceRule): InvoiceWindow {
  const ref = monthStart(referenceMonth);
  const dueDate = dateInMonth(ref, rule.dueDay);
  if ('closeBeforeDays' in rule) {
    return { referenceMonth: ref, closingDate: addDays(dueDate, -rule.closeBeforeDays), dueDate };
  }
  const closingMonth = rule.closingDay < rule.dueDay ? ref : addMonths(ref, -1);
  let closingDate = dateInMonth(closingMonth, rule.closingDay);
  if (compareDates(closingDate, dueDate) >= 0) closingDate = addDays(dueDate, -1);
  return { referenceMonth: ref, closingDate, dueDate };
}

/** Sugestão do formulário: fechamento = vencimento − 7, dando a volta no mês (10 → 3; 5 → 29). */
export function suggestClosingDay(dueDay: number): number {
  return ((dueDay - 8 + 31) % 31) + 1;
}

/** Janela efetiva do mês: a materializada (datas reais, editáveis) ou a da regra. */
export function windowFor(
  referenceMonth: ISODate,
  materialized: readonly InvoiceWindow[],
  rule: InvoiceRule,
) {
  const ref = monthStart(referenceMonth);
  return materialized.find((w) => w.referenceMonth === ref) ?? ruleInvoice(ref, rule);
}

/**
 * Invariante 5: a compra vai para a fatura com a MENOR closing_date > data da compra.
 * Considera as faturas materializadas (datas reais) e, onde não houver, a regra do cartão.
 */
export function resolveInvoice(
  purchaseDate: ISODate,
  materialized: readonly InvoiceWindow[],
  rule: InvoiceRule,
): InvoiceWindow {
  let best: InvoiceWindow | null = null;
  for (let k = -1; k <= 13; k++) {
    const w = windowFor(addMonths(monthStart(purchaseDate), k), materialized, rule);
    if (compareDates(w.closingDate, purchaseDate) <= 0) continue;
    if (!best || compareDates(w.closingDate, best.closingDate) < 0) best = w;
  }
  if (!best) throw new Error('Nenhuma fatura encontrada para a data da compra.');
  return best;
}

/** Faturas das parcelas: a parcela k vai na fatura seguinte à da k−1. */
export function invoiceSequence(
  firstReferenceMonth: ISODate,
  count: number,
  materialized: readonly InvoiceWindow[],
  rule: InvoiceRule,
): InvoiceWindow[] {
  return Array.from({ length: count }, (_, i) =>
    windowFor(addMonths(firstReferenceMonth, i), materialized, rule),
  );
}

export type InvoiceState = 'OPEN' | 'CLOSED' | 'OVERDUE' | 'PAID';

export const INVOICE_STATE_LABEL: Record<InvoiceState, string> = {
  OPEN: 'Aberta',
  CLOSED: 'Fechada',
  OVERDUE: 'Atrasada',
  PAID: 'Paga',
};

/** D30: situação derivada (nunca armazenada como verdade). */
export function invoiceState(i: {
  closingDate: ISODate;
  dueDate: ISODate;
  totalCents: Cents;
  paidCents: Cents;
  today: ISODate;
}): InvoiceState {
  if (compareDates(i.today, i.closingDate) < 0) return 'OPEN';
  if (i.totalCents <= 0 || i.paidCents >= i.totalCents) return 'PAID';
  if (compareDates(i.today, i.dueDate) > 0) return 'OVERDUE';
  return 'CLOSED';
}

/** D25: o que falta pagar (o parcial fica na própria fatura). */
export function remainingToPay(totalCents: Cents, paidCents: Cents): Cents {
  assertCents(totalCents);
  assertCents(paidCents);
  return Math.max(0, totalCents - paidCents);
}

/**
 * Limite disponível = limite total − Σ itens ACTIVE (todas as faturas) + Σ pagamentos de fatura.
 * null = limite não rastreado (adicional de terceiro). Pode passar do total (saldo credor).
 */
export function availableLimit(
  limitTotal: Cents | null,
  activeItemsCents: Cents,
  paymentsCents: Cents,
): Cents | null {
  if (limitTotal === null) return null;
  assertCents(limitTotal);
  assertCents(activeItemsCents);
  assertCents(paymentsCents);
  return limitTotal - activeItemsCents + paymentsCents;
}
