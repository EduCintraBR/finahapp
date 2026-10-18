import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DateError,
  dayOfWeek,
  formatDayLabel,
  addDays,
  addMonths,
  compareDates,
  dateInMonth,
  daysInMonth,
  diffDays,
  diffMonths,
  formatDateBR,
  formatMonthLabel,
  fromDayNumber,
  isISODate,
  monthEnd,
  monthStart,
  parseMonthParam,
  toDayNumber,
  toMonthParam,
  today,
} from './dates';

/** Referência só para teste: Date em UTC puro. */
const utcRef = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
};
const isoFromUtcDays = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

const isoDate = fc.integer({ min: utcRef('1900-01-01'), max: utcRef('2199-12-31') }).map(isoFromUtcDays);

describe('validação', () => {
  it.each(['2026-10-16', '2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31'])('%s é válida', (s) =>
    expect(isISODate(s)).toBe(true),
  );
  it.each([
    '2026-02-29',
    '1900-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-1-01',
    '16/10/2026',
    '',
  ])('%s é inválida', (s) => expect(isISODate(s)).toBe(false));
  it('erros em pt-BR', () => expect(() => addDays('2026-02-30', 1)).toThrow('Data inválida'));
  it('dias no mês', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(() => daysInMonth(2026, 13)).toThrow(DateError);
  });
});

describe('número do dia', () => {
  it('epoch', () => {
    expect(toDayNumber('1970-01-01')).toBe(0);
    expect(fromDayNumber(0)).toBe('1970-01-01');
    expect(toDayNumber('1969-12-31')).toBe(-1);
  });

  it('property: igual à referência UTC e reversível', () => {
    fc.assert(
      fc.property(isoDate, (d) => {
        expect(toDayNumber(d)).toBe(utcRef(d));
        expect(fromDayNumber(toDayNumber(d))).toBe(d);
      }),
    );
  });
});

describe('aritmética de dias', () => {
  it.each([
    ['2026-10-16', 1, '2026-10-17'],
    ['2026-10-31', 1, '2026-11-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2026-10-16', -7, '2026-10-09'],
  ])('%s %+d → %s', (d, n, expected) => expect(addDays(d, n)).toBe(expected));

  it('property: addDays e diffDays são inversas', () => {
    fc.assert(
      fc.property(isoDate, fc.integer({ min: -3000, max: 3000 }), (d, n) => {
        expect(diffDays(addDays(d, n), d)).toBe(n);
      }),
    );
  });

  it('compareDates', () => {
    expect(compareDates('2026-10-16', '2026-10-17')).toBe(-1);
    expect(compareDates('2026-10-16', '2026-10-16')).toBe(0);
    expect(compareDates('2027-01-01', '2026-12-31')).toBe(1);
  });
});

describe('meses', () => {
  it('início e fim do mês', () => {
    expect(monthStart('2026-10-16')).toBe('2026-10-01');
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
    expect(monthEnd('2028-02-10')).toBe('2028-02-29');
    expect(monthEnd('2026-12-01')).toBe('2026-12-31');
  });

  it.each([
    ['2027-02-01', 31, '2027-02-28'],
    ['2028-02-01', 30, '2028-02-29'],
    ['2026-04-01', 31, '2026-04-30'],
    ['2026-10-01', 3, '2026-10-03'],
    ['2026-10-20', 10, '2026-10-10'],
  ])('dateInMonth(%s, %i) → %s (dia inexistente vira o último)', (m, day, expected) =>
    expect(dateInMonth(m, day)).toBe(expected),
  );

  it('dateInMonth rejeita dia fora de 1..31', () => {
    expect(() => dateInMonth('2026-10-01', 0)).toThrow(DateError);
    expect(() => dateInMonth('2026-10-01', 32)).toThrow(DateError);
  });

  it.each([
    ['2026-01-31', 1, '2026-02-28'],
    ['2026-10-16', 3, '2027-01-16'],
    ['2026-10-16', -10, '2025-12-16'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2026-12-01', 1, '2027-01-01'],
  ])('addMonths(%s, %i) → %s', (d, n, expected) => expect(addMonths(d, n)).toBe(expected));

  it('property: addMonths cai no mês certo e nunca passa do dia original', () => {
    fc.assert(
      fc.property(isoDate, fc.integer({ min: -240, max: 240 }), (d, n) => {
        const r = addMonths(d, n);
        expect(diffMonths(r, d)).toBe(n);
        expect(Number(r.slice(8))).toBeLessThanOrEqual(Number(d.slice(8)));
      }),
    );
  });
});

describe('today()', () => {
  it('usa America/Sao_Paulo: 02:30 UTC ainda é o dia anterior', () => {
    expect(today(undefined, new Date('2026-10-17T02:30:00Z'))).toBe('2026-10-16');
    expect(today(undefined, new Date('2026-10-17T03:00:00Z'))).toBe('2026-10-17');
  });
  it('aceita outro fuso', () => {
    expect(today('UTC', new Date('2026-10-17T02:30:00Z'))).toBe('2026-10-17');
  });
});

describe('apresentação e URL', () => {
  it('parâmetro de mês', () => {
    expect(parseMonthParam('2026-10')).toBe('2026-10-01');
    expect(parseMonthParam('2026-13')).toBeNull();
    expect(parseMonthParam('2026-1')).toBeNull();
    expect(parseMonthParam(undefined)).toBeNull();
    expect(toMonthParam('2026-10-16')).toBe('2026-10');
  });
  it('rótulos pt-BR', () => {
    expect(formatMonthLabel('2026-10-01')).toBe('outubro de 2026');
    expect(formatMonthLabel('2027-03-01')).toBe('março de 2027');
    expect(formatDateBR('2026-10-06')).toBe('06/10/2026');
  });
});

describe('dia da semana', () => {
  it.each([
    ['1970-01-01', 4],
    ['2026-10-16', 5],
    ['2026-10-18', 0],
    ['1969-12-31', 3],
  ])('%s → %i', (d, dow) => expect(dayOfWeek(d)).toBe(dow));

  it('property: igual ao Date em UTC', () => {
    fc.assert(
      fc.property(isoDate, (d) => {
        expect(dayOfWeek(d)).toBe(new Date(`${d}T00:00:00Z`).getUTCDay());
      }),
    );
  });

  it('rótulo', () => expect(formatDayLabel('2026-10-16')).toBe('16/10 · sex'));
});
