/**
 * Projeção de mês futuro (SPEC §5.3, D39–D41), em memória — nada é gravado.
 *   resultado = receitas previstas − (fixos + estimativas de recorrentes + faturas que vencem no mês
 *               + assinaturas no cartão cuja fatura vence no mês)
 */
import { addMonths, compareDates, dateInMonth, monthStart, type ISODate } from '../dates';
import { resolveInvoice, type InvoiceRule, type InvoiceWindow } from '../card/invoices';
import type { Cents } from '../money';
import { isActiveInMonth, type TemplateWindow } from '../recurring/occurrences';

export type ProjectionTemplate = TemplateWindow & {
  direction: 'INCOME' | 'EXPENSE';
  type: 'FIXED' | 'RECURRING_VARIABLE';
  amountCents: Cents;
  /** assinatura no cartão: regra e faturas materializadas do cartão */
  card: { rule: InvoiceRule; invoices: readonly InvoiceWindow[] } | null;
};

export type MonthProjection = {
  month: ISODate;
  incomeCents: Cents;
  fixedCents: Cents;
  variableCents: Cents;
  invoicesCents: Cents;
  /** parcelas de empréstimo pendentes que vencem no mês */
  loansCents: Cents;
  subscriptionsCents: Cents;
  resultCents: Cents;
};

/** D39: assinaturas ainda não cobradas (data > hoje) cuja fatura vence no mês. */
export function subscriptionsDueIn(t: ProjectionTemplate, month: ISODate, today: ISODate): Cents {
  if (!t.card || t.direction !== 'EXPENSE') return 0;
  let total = 0;
  // a cobrança que cai na fatura que vence em M aconteceu em M−2..M
  for (let k = -2; k <= 0; k++) {
    const chargeMonth = addMonths(monthStart(month), k);
    if (!isActiveInMonth(t, chargeMonth)) continue;
    const chargeDate = dateInMonth(chargeMonth, t.dayOfMonth);
    if (compareDates(chargeDate, today) <= 0) continue; // já gerada: está nos itens da fatura
    if (resolveInvoice(chargeDate, t.card.invoices, t.card.rule).referenceMonth === monthStart(month)) {
      total += t.amountCents;
    }
  }
  return total;
}

export function projectMonth(input: {
  month: ISODate;
  today: ISODate;
  templates: readonly ProjectionTemplate[];
  /** o que falta pagar das faturas que vencem no mês (itens agendados − adiantamentos) */
  invoicesDueCents: Cents;
  /** parcelas de empréstimo ainda pendentes que vencem no mês (D66) */
  loansDueCents?: Cents;
}): MonthProjection {
  const month = monthStart(input.month);
  let incomeCents = 0;
  let fixedCents = 0;
  let variableCents = 0;
  let subscriptionsCents = 0;
  for (const t of input.templates) {
    if (t.card) {
      subscriptionsCents += subscriptionsDueIn(t, month, input.today);
      continue;
    }
    if (!isActiveInMonth(t, month)) continue;
    if (t.direction === 'INCOME') incomeCents += t.amountCents;
    else if (t.type === 'FIXED') fixedCents += t.amountCents;
    else variableCents += t.amountCents;
  }
  const loansCents = input.loansDueCents ?? 0;
  const resultCents =
    incomeCents - (fixedCents + variableCents + input.invoicesDueCents + subscriptionsCents + loansCents);
  return {
    month,
    incomeCents,
    fixedCents,
    variableCents,
    invoicesCents: input.invoicesDueCents,
    loansCents,
    subscriptionsCents,
    resultCents,
  };
}

/** D40: saldo estimado no fim de cada mês = saldo de partida + resultados acumulados. */
export function accumulate(startBalance: Cents, results: readonly Cents[]): Cents[] {
  let acc = startBalance;
  return results.map((r) => (acc += r));
}
