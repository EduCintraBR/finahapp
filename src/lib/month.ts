import { monthStart, parseMonthParam, today, type ISODate } from '@/domain/dates';
import { MONTH_PARAM } from '@/components/layout/month-link';

type SearchParams = Record<string, string | string[] | undefined>;

/** Mês selecionado na URL (?mes=AAAA-MM) ou o mês atual em America/Sao_Paulo. */
export async function resolveMonth(searchParams: Promise<SearchParams>): Promise<ISODate> {
  const raw = (await searchParams)[MONTH_PARAM];
  return parseMonthParam(typeof raw === 'string' ? raw : null) ?? monthStart(today());
}
