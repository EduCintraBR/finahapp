import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dayOfWeek, monthEnd } from '../dates';
import { creditDateFor, dueCreditMonths, lastBusinessDay, type CreditSchedule } from './credits';

describe('lastBusinessDay (sem feriados: segunda a sexta)', () => {
  it('mês que termina em dia útil', () => {
    expect(lastBusinessDay('2026-10-01')).toBe('2026-10-30'); // 31/10/2026 é sábado
    expect(lastBusinessDay('2026-11-01')).toBe('2026-11-30'); // segunda
    expect(lastBusinessDay('2026-12-01')).toBe('2026-12-31'); // quinta
  });

  it('fim de mês no domingo e no sábado volta para a sexta', () => {
    expect(lastBusinessDay('2026-05-01')).toBe('2026-05-29'); // 31/05 é domingo
    expect(lastBusinessDay('2026-10-01')).toBe('2026-10-30'); // 31/10 é sábado
  });

  it('fevereiro, bissexto ou não', () => {
    expect(lastBusinessDay('2028-02-01')).toBe('2028-02-29'); // terça
    expect(lastBusinessDay('2027-02-01')).toBe('2027-02-26'); // 28/02/2027 é domingo
  });

  it('property: é dia de semana, no mesmo mês, e no máximo 2 dias antes do fim', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2020, max: 2040 }), fc.integer({ min: 1, max: 12 }), (y, m) => {
        const month = `${y}-${String(m).padStart(2, '0')}-01`;
        const d = lastBusinessDay(month);
        expect(d.slice(0, 7)).toBe(month.slice(0, 7));
        expect([1, 2, 3, 4, 5]).toContain(dayOfWeek(d));
        const end = monthEnd(month);
        expect(Number(end.slice(8)) - Number(d.slice(8))).toBeLessThanOrEqual(2);
      }),
    );
  });
});

describe('creditDateFor', () => {
  it('último dia útil', () => {
    expect(creditDateFor({ rule: 'LAST_BUSINESS_DAY', day: null }, '2026-10-01')).toBe('2026-10-30');
  });

  it('dia fixo, e dia que não existe no mês vira o último dia do mês', () => {
    expect(creditDateFor({ rule: 'DAY_OF_MONTH', day: 5 }, '2026-10-01')).toBe('2026-10-05');
    expect(creditDateFor({ rule: 'DAY_OF_MONTH', day: 31 }, '2026-11-01')).toBe('2026-11-30');
    expect(creditDateFor({ rule: 'DAY_OF_MONTH', day: 30 }, '2027-02-01')).toBe('2027-02-28');
  });

  it('dia fixo sem dia é erro', () => {
    expect(() => creditDateFor({ rule: 'DAY_OF_MONTH', day: null }, '2026-10-01')).toThrow('dia do crédito');
  });
});

describe('dueCreditMonths', () => {
  const schedule: CreditSchedule = {
    rule: 'LAST_BUSINESS_DAY',
    day: null,
    startMonth: '2026-08-01',
    endMonth: null,
  };

  it('só os meses cujo dia de crédito já chegou e que ainda não foram creditados', () => {
    // hoje 29/10: o crédito de outubro é dia 30 → ainda não
    expect(dueCreditMonths(schedule, '2026-10-29', [])).toEqual(['2026-08-01', '2026-09-01']);
    expect(dueCreditMonths(schedule, '2026-10-30', [])).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
  });

  it('não repete o que já foi creditado (idempotente)', () => {
    expect(dueCreditMonths(schedule, '2026-10-30', ['2026-08-01', '2026-10-01'])).toEqual(['2026-09-01']);
    expect(dueCreditMonths(schedule, '2026-10-30', ['2026-08-01', '2026-09-01', '2026-10-01'])).toEqual([]);
  });

  it('encerrado: nenhum crédito depois do último mês, o histórico anterior continua valendo', () => {
    const ended = { ...schedule, endMonth: '2026-09-01' };
    expect(dueCreditMonths(ended, '2026-12-31', ['2026-08-01'])).toEqual(['2026-09-01']);
    expect(dueCreditMonths(ended, '2026-12-31', ['2026-08-01', '2026-09-01'])).toEqual([]);
  });

  it('antes do primeiro mês, nada', () => {
    expect(dueCreditMonths({ ...schedule, startMonth: '2026-11-01' }, '2026-10-31', [])).toEqual([]);
  });

  it('dia fixo: vale a partir do próprio dia', () => {
    const fixed: CreditSchedule = { rule: 'DAY_OF_MONTH', day: 5, startMonth: '2026-10-01', endMonth: null };
    expect(dueCreditMonths(fixed, '2026-10-04', [])).toEqual([]);
    expect(dueCreditMonths(fixed, '2026-10-05', [])).toEqual(['2026-10-01']);
  });
});
