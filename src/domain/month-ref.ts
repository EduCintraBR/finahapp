/**
 * Mês citado numa mensagem (bot): "novembro", "nov/2026", "mês que vem", "mês passado".
 * Regra: sem mês dito = mês atual (quem chama recebe null); nome do mês sem ano = o ano de hoje (passado ou
 * futuro); com ano = esse ano. Puro: "hoje" vem de fora.
 */
import { addMonths, monthStart, parseISODate, type ISODate } from './dates';

export type MonthRef = { offset?: number | null; month?: number | null; year?: number | null };

const MAX_OFFSET = 36;

const iso = (year: number, month: number): ISODate => `${year}-${String(month).padStart(2, '0')}-01`;

/** O que o modelo entendeu (offset relativo ou número do mês) → primeiro dia do mês. null = mês atual. */
export function resolveMonthRef(ref: MonthRef, today: ISODate): ISODate | null {
  const currentYear = parseISODate(today).year;
  if (ref.month != null) {
    if (!Number.isInteger(ref.month) || ref.month < 1 || ref.month > 12) return null;
    const year =
      ref.year != null && Number.isInteger(ref.year) && ref.year >= 2000 && ref.year <= 2100
        ? ref.year
        : currentYear;
    return iso(year, ref.month);
  }
  if (ref.offset != null && Number.isInteger(ref.offset) && Math.abs(ref.offset) <= MAX_OFFSET) {
    return addMonths(monthStart(today), ref.offset);
  }
  return null;
}

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const NAMES: Record<string, number> = {
  janeiro: 1,
  jan: 1,
  fevereiro: 2,
  fev: 2,
  marco: 3,
  mar: 3,
  abril: 4,
  abr: 4,
  maio: 5,
  mai: 5,
  junho: 6,
  jun: 6,
  julho: 7,
  jul: 7,
  agosto: 8,
  ago: 8,
  setembro: 9,
  set: 9,
  outubro: 10,
  out: 10,
  novembro: 11,
  nov: 11,
  dezembro: 12,
  dez: 12,
};

export type MonthArg = { ok: true; month: ISODate | null } | { ok: false };

/** Argumento de comando ("novembro", "11/2026", "próximo"). month null = mês atual. */
export function parseMonthArg(text: string, today: ISODate): MonthArg {
  const t = plain(text)
    .replace(/\bde\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t === '' || /^(atual|este mes|esse mes|mes atual|este|esse)$/.test(t)) return { ok: true, month: null };
  if (/^(proximo|prox|mes que vem|que vem|seguinte|proximo mes)$/.test(t)) {
    return { ok: true, month: resolveMonthRef({ offset: 1 }, today) };
  }
  if (/^(passado|anterior|mes passado|mes anterior)$/.test(t)) {
    return { ok: true, month: resolveMonthRef({ offset: -1 }, today) };
  }
  const currentYear = parseISODate(today).year;
  const yearOf = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

  let m = /^(\d{4})-(\d{1,2})$/.exec(t);
  if (m) return build(Number(m[2]), yearOf(m[1]!));
  m = /^(\d{1,2})[/ -](\d{4}|\d{2})$/.exec(t);
  if (m) return build(Number(m[1]), yearOf(m[2]!));
  m = /^(\d{1,2})$/.exec(t);
  if (m) return build(Number(m[1]), currentYear);
  m = /^([a-z]+)(?:[/ -](\d{4}|\d{2}))?$/.exec(t);
  if (m && NAMES[m[1]!] !== undefined) return build(NAMES[m[1]!]!, m[2] ? yearOf(m[2]) : currentYear);
  return { ok: false };
}

function build(month: number, year: number): MonthArg {
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return { ok: false };
  return { ok: true, month: iso(year, month) };
}
