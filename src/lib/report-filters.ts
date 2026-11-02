import type { ReportFilters } from '@/db/queries/reports';
import { ACCOUNT_PAYMENT_METHODS } from '@/lib/labels';

type SearchParams = Record<string, string | string[] | undefined>;

export const str = (v: string | string[] | undefined) => (typeof v === 'string' && v !== '' ? v : undefined);
export const uuidParam = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

/** Filtros de Relatórios na URL (?lancou, ?dequem, ?cartao, ?categoria, ?meio); o detalhe da categoria repassa os mesmos. */
export function parseReportFilters(sp: SearchParams): ReportFilters {
  const meio = str(sp.meio);
  return {
    createdBy: uuidParam(str(sp.lancou)),
    beneficiary: str(sp.dequem) === 'casal' ? 'casal' : uuidParam(str(sp.dequem)),
    cardId: uuidParam(str(sp.cartao)),
    // categoria-mãe inclui as subcategorias; subcategoria filtra só ela (D74)
    categoryId: uuidParam(str(sp.categoria)),
    paymentMethod:
      meio === 'CREDIT_CARD' || meio === 'BENEFIT_CARD' || ACCOUNT_PAYMENT_METHODS.includes(meio as never)
        ? meio
        : undefined,
  };
}

/** Os parâmetros de filtro presentes na URL, para repassar num link. */
export function filterParams(sp: SearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['lancou', 'dequem', 'cartao', 'categoria', 'meio']) {
    const v = str(sp[k]);
    if (v) out[k] = v;
  }
  return out;
}
