/**
 * Cartão de benefícios (vale-refeição / multibenefícios): quando o empregador credita (D65).
 * Regras puras, sem banco. "Hoje" vem de fora. Sem calendário de feriados: dia útil = segunda a sexta
 * (o crédito de um feriado cai no dia certo do app, e o saldo real só difere por horas).
 */
import {
  addDays,
  addMonths,
  compareDates,
  dateInMonth,
  dayOfWeek,
  monthEnd,
  monthStart,
  type ISODate,
} from '../dates';

/** Máximo de carteiras por cartão de benefícios. */
export const MAX_BENEFIT_WALLETS = 6;

export type CreditRule = 'LAST_BUSINESS_DAY' | 'DAY_OF_MONTH';

export type CreditSchedule = {
  rule: CreditRule;
  /** só para DAY_OF_MONTH (1 a 31; dia que não existe no mês vira o último dia) */
  day: number | null;
  /** primeiro mês com crédito (dia 1) */
  startMonth: ISODate;
  /** último mês com crédito (dia 1); null = sem fim. É assim que o cartão é "encerrado". */
  endMonth: ISODate | null;
};

/** Último dia útil (segunda a sexta) do mês de `month`. */
export function lastBusinessDay(month: ISODate): ISODate {
  let d = monthEnd(month);
  while (dayOfWeek(d) === 0 || dayOfWeek(d) === 6) d = addDays(d, -1);
  return d;
}

/** Data em que o crédito do mês cai. */
export function creditDateFor(schedule: Pick<CreditSchedule, 'rule' | 'day'>, month: ISODate): ISODate {
  if (schedule.rule === 'LAST_BUSINESS_DAY') return lastBusinessDay(month);
  if (!schedule.day || schedule.day < 1 || schedule.day > 31) {
    throw new Error('Informe o dia do crédito (1 a 31).');
  }
  return dateInMonth(month, schedule.day);
}

/**
 * Meses que já deviam ter sido creditados e ainda não foram: do primeiro mês até o último (ou o mês de hoje),
 * só os que chegaram no dia do crédito. `done` são os meses já creditados (idempotência).
 */
export function dueCreditMonths(
  schedule: CreditSchedule,
  today: ISODate,
  done: readonly ISODate[],
): ISODate[] {
  const seen = new Set(done);
  const last =
    schedule.endMonth && compareDates(schedule.endMonth, today) < 0 ? schedule.endMonth : monthStart(today);
  const out: ISODate[] = [];
  for (let m = monthStart(schedule.startMonth); compareDates(m, last) <= 0; m = addMonths(m, 1)) {
    if (seen.has(m)) continue;
    if (compareDates(creditDateFor(schedule, m), today) <= 0) out.push(m);
  }
  return out;
}
