/**
 * Envase, rodízio e conferência da Casa (D84, D85): validade do lote envasado, de quais lotes ele sai, a próxima
 * conferência e a idade de cada lote. Tudo em datas 'YYYY-MM-DD', com "hoje" recebido de fora.
 */
import { addMonths, compareDates, diffDays, diffMonths, type ISODate } from '../dates';
import { quantityAfter, StockError } from './quantity';

/** Validade do lote envasado = selagem + prazo depois de envasado do produto (sem prazo: o usuário informa). */
export function repackExpiry(sealDate: ISODate, shelfLifeMonths: number | null): ISODate | null {
  return shelfLifeMonths ? addMonths(sealDate, shelfLifeMonths) : null;
}

export type RepackSourceLot = { id: string; code: string; quantity: number };

/**
 * Embalagens que saem de cada lote de origem num envase. Ignora as linhas zeradas, recusa lote de outro produto,
 * lote repetido, quantidade que deixaria o lote negativo e envase sem nenhuma origem.
 */
export function planRepack(
  lots: readonly RepackSourceLot[],
  sources: readonly { lotId: string; packages: number }[],
): { lotId: string; packages: number }[] {
  const byId = new Map(lots.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const plan: { lotId: string; packages: number }[] = [];
  for (const s of sources) {
    if (s.packages === 0) continue;
    if (!Number.isSafeInteger(s.packages) || s.packages < 0) {
      throw new StockError('A quantidade de cada lote é um número inteiro de embalagens.');
    }
    const lot = byId.get(s.lotId);
    if (!lot) throw new StockError('Lote de origem não encontrado neste produto.');
    if (seen.has(lot.id)) throw new StockError(`O lote ${lot.code} aparece duas vezes.`);
    seen.add(lot.id);
    quantityAfter(lot.quantity, -s.packages, lot.code);
    plan.push({ lotId: lot.id, packages: s.packages });
  }
  if (plan.length === 0) throw new StockError('Escolha de qual lote saem as embalagens envasadas.');
  return plan;
}

/** Próxima conferência: a última (ou a selagem/entrada) + N meses; sem conferência periódica, null. */
export function nextCheckDate(
  entryDate: ISODate,
  lastCheckDate: ISODate | null,
  everyMonths: number | null,
): ISODate | null {
  if (!everyMonths) return null;
  const base = lastCheckDate && compareDates(lastCheckDate, entryDate) > 0 ? lastCheckDate : entryDate;
  return addMonths(base, everyMonths);
}

/** Conferência a fazer: a data chegou (ou passou). */
export function checkDue(next: ISODate | null, today: ISODate): boolean {
  return next !== null && compareDates(next, today) <= 0;
}

/** Idade do lote desde a selagem/entrada: "hoje", "há 12 dias", "há 8 meses", "há 1 ano e 2 meses". */
export function ageText(since: ISODate, today: ISODate): string {
  const days = diffDays(today, since);
  if (days <= 0) return 'hoje';
  // mês completo só quando o dia do mês já chegou (de 20/01 a 10/03 = 1 mês)
  let months = diffMonths(today, since);
  if (compareDates(addMonths(since, months), today) > 0) months -= 1;
  if (months < 1) return days === 1 ? 'há 1 dia' : `há ${days} dias`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const m = (n: number) => (n === 1 ? '1 mês' : `${n} meses`);
  if (years === 0) return `há ${m(months)}`;
  const y = years === 1 ? '1 ano' : `${years} anos`;
  return rest === 0 ? `há ${y}` : `há ${y} e ${m(rest)}`;
}
