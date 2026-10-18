import { parseMonthParam } from '@/domain/dates';

export const MONTH_PARAM = 'mes';

/** Mantém o mês selecionado (?mes=AAAA-MM) ao navegar entre as telas. */
export function withMonth(href: string, params: Pick<URLSearchParams, 'get'>): string {
  const month = params.get(MONTH_PARAM);
  return month && parseMonthParam(month) ? `${href}?${MONTH_PARAM}=${month}` : href;
}
