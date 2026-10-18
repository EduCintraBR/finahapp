/**
 * Fixos, recorrentes e receitas previstas (SPEC §4).
 * Ocorrência = transaction PENDING com (template, mês) único; due_date = dia do template no mês
 * (dia inexistente → último dia do mês).
 *
 * D17: gera retroativamente de max(início do template, mês do saldo inicial) até o mês ATUAL.
 *      Meses futuros nunca são persistidos (a projeção calcula em memória). Vencimentos anteriores
 *      à data do saldo inicial não são gerados (já estavam pagos antes do controle — D18).
 * Templates no cartão (CREDIT_CARD) viram compra à vista no dia da cobrança (D33): cardChargesDue.
 */
import { addMonths, compareDates, dateInMonth, isISODate, monthStart, type ISODate } from '../dates';

export type TemplateWindow = {
  id: string;
  startMonth: ISODate;
  endMonth: ISODate | null;
  isActive: boolean;
  dayOfMonth: number;
  paymentMethod: string;
};

export type OccurrencePlan = { templateId: string; occurrenceMonth: ISODate; dueDate: ISODate };

export const occurrenceKey = (templateId: string, month: ISODate) => `${templateId}|${month}`;

export function isActiveInMonth(t: TemplateWindow, month: ISODate): boolean {
  return (
    t.isActive &&
    compareDates(t.startMonth, month) <= 0 &&
    (t.endMonth === null || compareDates(month, t.endMonth) <= 0)
  );
}

/** Meses (1º dia) em que o template deve ter ocorrência materializada, em ordem. */
export function monthsToMaterialize(t: TemplateWindow, openingDate: ISODate, today: ISODate): ISODate[] {
  if (t.paymentMethod === 'CREDIT_CARD') return [];
  const from = [t.startMonth, monthStart(openingDate)].sort()[1]!;
  const until = monthStart(today);
  const months: ISODate[] = [];
  for (let m = from; compareDates(m, until) <= 0; m = addMonths(m, 1)) {
    if (isActiveInMonth(t, m) && compareDates(dateInMonth(m, t.dayOfMonth), openingDate) >= 0) months.push(m);
  }
  return months;
}

export type CardCharge = { month: ISODate; chargeDate: ISODate };

/** D33: cobranças de assinatura no cartão cujo dia já chegou (e não antes do saldo inicial). */
export function cardChargesDue(t: TemplateWindow, openingDate: ISODate, today: ISODate): CardCharge[] {
  if (t.paymentMethod !== 'CREDIT_CARD') return [];
  const from = [t.startMonth, monthStart(openingDate)].sort()[1]!;
  const charges: CardCharge[] = [];
  for (let m = from; compareDates(m, monthStart(today)) <= 0; m = addMonths(m, 1)) {
    if (!isActiveInMonth(t, m)) continue;
    const chargeDate = dateInMonth(m, t.dayOfMonth);
    if (compareDates(chargeDate, openingDate) >= 0 && compareDates(chargeDate, today) <= 0) {
      charges.push({ month: m, chargeDate });
    }
  }
  return charges;
}

/**
 * Ocorrências que faltam criar. `existing` = chaves (template|mês) já existentes e não deletadas.
 * Rodar duas vezes não cria nada novo (idempotente); o índice único do banco é a última defesa.
 */
export function planOccurrences(
  templates: readonly TemplateWindow[],
  existing: ReadonlySet<string>,
  openingDate: ISODate,
  today: ISODate,
): OccurrencePlan[] {
  const plans: OccurrencePlan[] = [];
  for (const t of templates) {
    for (const month of monthsToMaterialize(t, openingDate, today)) {
      if (existing.has(occurrenceKey(t.id, month))) continue;
      plans.push({ templateId: t.id, occurrenceMonth: month, dueDate: dateInMonth(month, t.dayOfMonth) });
    }
  }
  return plans;
}

export type ChangeFromPlan =
  { mode: 'IN_PLACE' } | { mode: 'SPLIT'; oldEndMonth: ISODate; newStartMonth: ISODate };

/**
 * "Alterar a partir de" (D21): encerra o template no mês anterior e cria um novo a partir de
 * `effectiveMonth`. Se a mudança vale desde o início do template, edita no lugar.
 */
export function planChangeFrom(
  t: Pick<TemplateWindow, 'startMonth' | 'endMonth'>,
  effectiveMonth: ISODate,
): ChangeFromPlan | { error: string } {
  if (!isISODate(effectiveMonth) || effectiveMonth !== monthStart(effectiveMonth)) {
    return { error: 'Informe o mês a partir do qual a mudança vale.' };
  }
  if (compareDates(effectiveMonth, t.startMonth) < 0) {
    return { error: 'A mudança não pode valer antes do início do lançamento fixo.' };
  }
  if (t.endMonth !== null && compareDates(effectiveMonth, t.endMonth) > 0) {
    return { error: 'Este lançamento fixo já estava encerrado nesse mês.' };
  }
  if (effectiveMonth === t.startMonth) return { mode: 'IN_PLACE' };
  return { mode: 'SPLIT', oldEndMonth: addMonths(effectiveMonth, -1), newStartMonth: effectiveMonth };
}
