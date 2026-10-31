import { parseMonthParam, toMonthParam, type ISODate } from '@/domain/dates';

export const MONTH_PARAM = 'mes';

/** "?mes=AAAA-MM" para links montados no servidor; vazio quando é o mês atual (o padrão). */
export function monthSuffix(month: ISODate, currentMonth: ISODate): string {
  return month === currentMonth ? '' : `?${MONTH_PARAM}=${toMonthParam(month)}`;
}

/** Mantém o mês selecionado (?mes=AAAA-MM) ao navegar entre as telas (o #âncora continua no fim). */
export function withMonth(href: string, params: Pick<URLSearchParams, 'get'>): string {
  const month = params.get(MONTH_PARAM);
  if (!month || !parseMonthParam(month)) return href;
  const [path, hash] = href.split('#');
  return `${path}?${MONTH_PARAM}=${month}${hash ? `#${hash}` : ''}`;
}
