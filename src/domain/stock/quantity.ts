/**
 * Quantidade do estoque da Casa (D83): NUNCA armazenada. A de um lote é a soma dos movimentos não cancelados, em
 * embalagens inteiras; a do produto é a soma dos lotes. Nenhuma operação aceita deixa um lote negativo.
 */
import { addDays, compareDates, type ISODate } from '../dates';

export type MovementKind = 'IN' | 'USE' | 'DISCARD' | 'ADJUST' | 'REPACK_OUT' | 'REPACK_IN';

/** Maior número de embalagens num movimento: um limite de digitação, não de regra. */
export const MAX_PACKAGES = 100_000;

/** Vencendo = validade nos próximos 30 dias (D85). */
export const SOON_DAYS = 30;

export class StockError extends Error {
  override name = 'StockError';
}

const ENTERS: readonly MovementKind[] = ['IN', 'REPACK_IN'];
const LEAVES: readonly MovementKind[] = ['USE', 'DISCARD', 'REPACK_OUT'];

/** Embalagens digitadas (sempre > 0) → valor assinado do movimento pela direção do tipo. ADJUST vem assinado. */
export function signedQuantity(kind: MovementKind, packages: number): number {
  if (!Number.isSafeInteger(packages) || packages === 0) {
    throw new StockError('A quantidade precisa ser um número inteiro de embalagens.');
  }
  if (kind === 'ADJUST') return packages;
  if (packages < 0) throw new StockError('A quantidade precisa ser maior que zero.');
  if (packages > MAX_PACKAGES) throw new StockError('Quantidade alta demais.');
  if (ENTERS.includes(kind)) return packages;
  if (LEAVES.includes(kind)) return -packages;
  throw new StockError('Tipo de movimento desconhecido.');
}

/** Quantidade de um lote: Σ movimentos não cancelados. */
export function lotQuantity(movements: readonly { quantity: number; cancelled: boolean }[]): number {
  let total = 0;
  for (const m of movements) if (!m.cancelled) total += m.quantity;
  return total;
}

/** Quantidade depois do movimento; recusa o que deixaria o lote negativo. */
export function quantityAfter(current: number, delta: number, lotCode: string): number {
  const next = current + delta;
  if (next < 0) {
    throw new StockError(
      current === 0
        ? `O lote ${lotCode} já está zerado.`
        : `O lote ${lotCode} tem só ${current} ${current === 1 ? 'embalagem' : 'embalagens'}.`,
    );
  }
  return next;
}

/** "Contei": diferença entre o que foi contado e o que o app tem (o movimento ADJUST). */
export function adjustmentDelta(current: number, counted: number): number {
  if (!Number.isSafeInteger(counted) || counted < 0) {
    throw new StockError('A contagem precisa ser um número inteiro (zero ou mais).');
  }
  if (counted > MAX_PACKAGES) throw new StockError('Quantidade alta demais.');
  if (counted === current) throw new StockError('A contagem é igual à do app: nada para ajustar.');
  return counted - current;
}

export type FefoLot = {
  id: string;
  number: number;
  quantity: number;
  entryDate: ISODate;
  expiryDate: ISODate | null;
};

/**
 * Ordem de uso (FEFO, D85): validade mais próxima primeiro (sem validade por último); no empate, a entrada mais
 * antiga; depois, o número do lote. Não muda o array recebido.
 */
export function sortFefo<T extends FefoLot>(lots: readonly T[]): T[] {
  return [...lots].sort((a, b) => {
    if (a.expiryDate !== b.expiryDate) {
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return compareDates(a.expiryDate, b.expiryDate);
    }
    return compareDates(a.entryDate, b.entryDate) || a.number - b.number;
  });
}

/**
 * Tira `packages` embalagens dos lotes na ordem FEFO: esgota o primeiro antes de passar ao seguinte.
 * Recusa quando o estoque do produto não tem tudo isso.
 */
export function allocateFefo(
  lots: readonly FefoLot[],
  packages: number,
): { lotId: string; packages: number }[] {
  if (!Number.isSafeInteger(packages) || packages <= 0) {
    throw new StockError('A quantidade precisa ser maior que zero.');
  }
  const available = lots.reduce((s, l) => s + Math.max(l.quantity, 0), 0);
  if (available < packages) {
    throw new StockError(
      available === 0
        ? 'Este produto está sem estoque.'
        : `Só tem ${available} ${available === 1 ? 'embalagem' : 'embalagens'} no estoque.`,
    );
  }
  const out: { lotId: string; packages: number }[] = [];
  let left = packages;
  for (const lot of sortFefo(lots)) {
    if (left === 0) break;
    if (lot.quantity <= 0) continue;
    const take = Math.min(lot.quantity, left);
    out.push({ lotId: lot.id, packages: take });
    left -= take;
  }
  return out;
}

/**
 * Total do produto na medida dele: Σ embalagens × conteúdo de cada uma (sem conteúdo = 1 unidade por embalagem).
 * Só lotes com quantidade positiva.
 */
export function totalInMeasure(
  lots: readonly { quantity: number; contentPerPackage: number | null }[],
): number {
  let total = 0;
  for (const l of lots) if (l.quantity > 0) total += l.quantity * (l.contentPerPackage ?? 1);
  return total;
}

export type ExpiryLevel = 'expired' | 'soon' | 'ok';

/** Vencido (antes de hoje), vencendo (até 30 dias) ou ok; sem validade = null. */
export function expiryLevel(expiryDate: ISODate | null, today: ISODate): ExpiryLevel | null {
  if (!expiryDate) return null;
  if (compareDates(expiryDate, today) < 0) return 'expired';
  if (compareDates(expiryDate, addDays(today, SOON_DAYS)) <= 0) return 'soon';
  return 'ok';
}
