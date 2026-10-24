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
  /** receitas previstas dos templates + lançamentos agendados do mês */
  incomeCents: Cents;
  /** só as receitas previstas dos templates (sem os agendados) */
  templateIncomeCents: Cents;
  fixedCents: Cents;
  variableCents: Cents;
  invoicesCents: Cents;
  /** parcelas de empréstimo pendentes que vencem no mês */
  loansCents: Cents;
  /** saídas já registradas com data neste mês (agendadas) */
  scheduledOutCents: Cents;
  subscriptionsCents: Cents;
  resultCents: Cents;
};

/** D39: datas das cobranças de assinatura ainda não feitas (data > hoje) cuja fatura vence no mês. */
export function subscriptionChargeDates(t: ProjectionTemplate, month: ISODate, today: ISODate): ISODate[] {
  if (!t.card || t.direction !== 'EXPENSE') return [];
  const out: ISODate[] = [];
  // a cobrança que cai na fatura que vence em M aconteceu em M−2..M
  for (let k = -2; k <= 0; k++) {
    const chargeMonth = addMonths(monthStart(month), k);
    if (!isActiveInMonth(t, chargeMonth)) continue;
    const chargeDate = dateInMonth(chargeMonth, t.dayOfMonth);
    if (compareDates(chargeDate, today) <= 0) continue; // já gerada: está nos itens da fatura
    if (resolveInvoice(chargeDate, t.card.invoices, t.card.rule).referenceMonth === monthStart(month)) {
      out.push(chargeDate);
    }
  }
  return out;
}

/** D39: assinaturas ainda não cobradas (data > hoje) cuja fatura vence no mês. */
export function subscriptionsDueIn(t: ProjectionTemplate, month: ISODate, today: ISODate): Cents {
  return subscriptionChargeDates(t, month, today).length * t.amountCents;
}

/** Um item que um fixo/recorrente vai gerar no mês (D68): a lista por trás dos totais da projeção. */
export type ProjectedItem = {
  templateId: string;
  direction: 'INCOME' | 'EXPENSE';
  type: 'FIXED' | 'RECURRING_VARIABLE';
  amountCents: Cents;
  /** vencimento no mês (conta) ou dia da cobrança (assinatura no cartão) */
  dueDate: ISODate;
  /** assinatura no cartão: vai para a fatura, não para a conta */
  subscription: boolean;
};

/**
 * Itens previstos dos fixos e recorrentes para `month`. Ocorrências de meses futuros não são gravadas (CLAUDE.md):
 * esta lista e os totais de projectMonth saem do mesmo cálculo, então nunca divergem.
 */
export function projectedItems(
  templates: readonly ProjectionTemplate[],
  month: ISODate,
  today: ISODate,
): ProjectedItem[] {
  const m = monthStart(month);
  const out: ProjectedItem[] = [];
  for (const t of templates) {
    const base = { templateId: t.id, direction: t.direction, type: t.type, amountCents: t.amountCents };
    if (t.card) {
      for (const dueDate of subscriptionChargeDates(t, m, today)) {
        out.push({ ...base, dueDate, subscription: true });
      }
      continue;
    }
    if (!isActiveInMonth(t, m)) continue;
    out.push({ ...base, dueDate: dateInMonth(m, t.dayOfMonth), subscription: false });
  }
  return out.sort((a, b) => compareDates(a.dueDate, b.dueDate));
}

export function projectMonth(input: {
  month: ISODate;
  today: ISODate;
  templates: readonly ProjectionTemplate[];
  /** o que falta pagar das faturas que vencem no mês (itens agendados − adiantamentos) */
  invoicesDueCents: Cents;
  /** parcelas de empréstimo ainda pendentes que vencem no mês (D66) */
  loansDueCents?: Cents;
  /** lançamentos já registrados com data neste mês (futuro), que a projeção não deve ignorar (D67) */
  scheduledInCents?: Cents;
  scheduledOutCents?: Cents;
}): MonthProjection {
  const month = monthStart(input.month);
  let templateIncomeCents = 0;
  let fixedCents = 0;
  let variableCents = 0;
  let subscriptionsCents = 0;
  for (const it of projectedItems(input.templates, month, input.today)) {
    if (it.subscription) subscriptionsCents += it.amountCents;
    else if (it.direction === 'INCOME') templateIncomeCents += it.amountCents;
    else if (it.type === 'FIXED') fixedCents += it.amountCents;
    else variableCents += it.amountCents;
  }
  const loansCents = input.loansDueCents ?? 0;
  const scheduledOutCents = input.scheduledOutCents ?? 0;
  const incomeCents = templateIncomeCents + (input.scheduledInCents ?? 0);
  const resultCents =
    incomeCents -
    (fixedCents +
      variableCents +
      input.invoicesDueCents +
      subscriptionsCents +
      loansCents +
      scheduledOutCents);
  return {
    month,
    incomeCents,
    templateIncomeCents,
    fixedCents,
    variableCents,
    invoicesCents: input.invoicesDueCents,
    loansCents,
    scheduledOutCents,
    subscriptionsCents,
    resultCents,
  };
}

/** D40: saldo estimado no fim de cada mês = saldo de partida + resultados acumulados. */
export function accumulate(startBalance: Cents, results: readonly Cents[]): Cents[] {
  let acc = startBalance;
  return results.map((r) => (acc += r));
}
