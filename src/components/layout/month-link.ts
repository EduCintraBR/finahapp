import { parseMonthParam, toMonthParam, type ISODate } from '@/domain/dates';

export const MONTH_PARAM = 'mes';

/** "?mes=AAAA-MM" para links montados no servidor; vazio quando é o mês atual (o padrão). */
export function monthSuffix(month: ISODate, currentMonth: ISODate): string {
  return month === currentMonth ? '' : `?${MONTH_PARAM}=${toMonthParam(month)}`;
}

/** Mantém o mês selecionado (?mes=AAAA-MM) ao navegar entre as telas. */
export function withMonth(href: string, params: Pick<URLSearchParams, 'get'>): string {
  const month = params.get(MONTH_PARAM);
  return month && parseMonthParam(month) ? `${href}?${MONTH_PARAM}=${month}` : href;
}
