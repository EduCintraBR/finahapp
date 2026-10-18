/**
 * Datas de negócio do Finah: strings 'YYYY-MM-DD' (coluna DATE mode 'string').
 * A aritmética é feita sobre o número do dia civil (algoritmo de Howard Hinnant),
 * sem `Date` e sem fuso horário: '2026-10-16' é sempre o dia 16, em qualquer servidor.
 * "Mês" = DATE do 1º dia do mês ('2026-10-01').
 */

/** Data de negócio 'YYYY-MM-DD'. */
export type ISODate = string;

export const DEFAULT_TZ = 'America/Sao_Paulo';

export class DateError extends Error {
  override name = 'DateError';
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  const days = MONTH_DAYS[month - 1];
  if (days === undefined) throw new DateError(`Mês inválido: ${month}.`);
  return days;
}

export type DateParts = { year: number; month: number; day: number };

export function isISODate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

export function assertISODate(value: string): asserts value is ISODate {
  if (!isISODate(value)) throw new DateError(`Data inválida: "${value}". Use o formato AAAA-MM-DD.`);
}

export function parseISODate(value: ISODate): DateParts {
  assertISODate(value);
  const [y, m, d] = value.split('-');
  return { year: Number(y), month: Number(m), day: Number(d) };
}

export function formatISODate({ year, month, day }: DateParts): ISODate {
  const s = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  assertISODate(s);
  return s;
}

/** Dias desde 1970-01-01 (pode ser negativo). */
export function toDayNumber(value: ISODate): number {
  const { year, month, day } = parseISODate(value);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDayNumber(dayNumber: number): ISODate {
  if (!Number.isSafeInteger(dayNumber)) throw new DateError('Número de dia inválido.');
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return formatISODate({ year, month, day });
}

export function addDays(value: ISODate, days: number): ISODate {
  if (!Number.isInteger(days)) throw new DateError('Quantidade de dias precisa ser inteira.');
  return fromDayNumber(toDayNumber(value) + days);
}

/** a − b em dias. */
export function diffDays(a: ISODate, b: ISODate): number {
  return toDayNumber(a) - toDayNumber(b);
}

export function compareDates(a: ISODate, b: ISODate): -1 | 0 | 1 {
  const d = diffDays(a, b);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

/** 1º dia do mês da data: '2026-10-16' → '2026-10-01'. */
export function monthStart(value: ISODate): ISODate {
  const { year, month } = parseISODate(value);
  return formatISODate({ year, month, day: 1 });
}

/** Último dia do mês da data: '2026-02-10' → '2026-02-28'. */
export function monthEnd(value: ISODate): ISODate {
  const { year, month } = parseISODate(value);
  return formatISODate({ year, month, day: daysInMonth(year, month) });
}

export function isSameMonth(a: ISODate, b: ISODate): boolean {
  return monthStart(a) === monthStart(b);
}

/**
 * Data com o dia `day` no mês de `month`; dia inexistente → último dia do mês.
 * dateInMonth('2027-02-01', 31) → '2027-02-28'.
 */
export function dateInMonth(month: ISODate, day: number): ISODate {
  if (!Number.isInteger(day) || day < 1 || day > 31) throw new DateError(`Dia inválido: ${day}.`);
  const { year, month: m } = parseISODate(month);
  return formatISODate({ year, month: m, day: Math.min(day, daysInMonth(year, m)) });
}

/** Soma meses mantendo o dia, limitado ao último dia do mês: '2026-01-31' + 1 → '2026-02-28'. */
export function addMonths(value: ISODate, months: number): ISODate {
  if (!Number.isInteger(months)) throw new DateError('Quantidade de meses precisa ser inteira.');
  const { year, month, day } = parseISODate(value);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12 + 1;
  return dateInMonth(formatISODate({ year: targetYear, month: targetMonth, day: 1 }), day);
}

/** Meses entre os meses de a e b (a − b): ('2027-01-15', '2026-10-31') → 3. */
export function diffMonths(a: ISODate, b: ISODate): number {
  const pa = parseISODate(a);
  const pb = parseISODate(b);
  return pa.year * 12 + pa.month - (pb.year * 12 + pb.month);
}

/**
 * "Hoje" no fuso do casal. `now` é injetável para testes e jobs;
 * nenhuma regra de domínio deve chamar isto implicitamente: recebem `today` como parâmetro.
 */
export function today(tz: string = DEFAULT_TZ, now: Date = new Date()): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  return formatISODate({ year: get('year'), month: get('month'), day: get('day') });
}

// ─────────── parâmetros de URL e apresentação ───────────

const MONTH_PARAM = /^(\d{4})-(\d{2})$/;

/** '2026-10' → '2026-10-01'; inválido → null. */
export function parseMonthParam(value: string | null | undefined): ISODate | null {
  const m = value ? MONTH_PARAM.exec(value) : null;
  if (!m) return null;
  const s = `${m[1]}-${m[2]}-01`;
  return isISODate(s) ? s : null;
}

/** '2026-10-01' → '2026-10'. */
export function toMonthParam(month: ISODate): string {
  return monthStart(month).slice(0, 7);
}

const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

/** '2026-10-01' → 'outubro de 2026'. */
export function formatMonthLabel(month: ISODate): string {
  const { year, month: m } = parseISODate(month);
  return `${MONTH_NAMES[m - 1]} de ${year}`;
}

/** '2026-10-16' → '16/10/2026'. */
export function formatDateBR(value: ISODate): string {
  const { year, month, day } = parseISODate(value);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

/** Dia da semana (0 = domingo … 6 = sábado). 1970-01-01 foi uma quinta-feira. */
export function dayOfWeek(value: ISODate): number {
  return (((toDayNumber(value) + 4) % 7) + 7) % 7;
}

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

/** '2026-10-16' → '16/10 · sex'. */
export function formatDayLabel(value: ISODate): string {
  return `${formatDateBR(value).slice(0, 5)} · ${WEEKDAY_SHORT[dayOfWeek(value)]}`;
}
