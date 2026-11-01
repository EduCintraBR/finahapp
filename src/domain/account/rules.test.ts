import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays } from '../dates';
import {
  checkNotBeforeOpening,
  dueHighlight,
  fundingNeeded,
  isScheduled,
  overdueCutoff,
  pendingCountsInMonth,
} from './rules';

describe('checkNotBeforeOpening (D18)', () => {
  it('bloqueia data anterior ao saldo inicial', () => {
    expect(checkNotBeforeOpening('2026-09-30', '2026-10-01')).toBe(
      'A data não pode ser anterior ao início do controle (01/10/2026).',
    );
  });
  it('aceita o próprio dia e depois', () => {
    expect(checkNotBeforeOpening('2026-10-01', '2026-10-01')).toBeNull();
    expect(checkNotBeforeOpening('2027-01-15', '2026-10-01')).toBeNull();
  });
});

describe('dueHighlight', () => {
  const today = '2026-10-30';
  it.each([
    ['2026-10-29', 'OVERDUE'],
    ['2026-09-01', 'OVERDUE'],
    ['2026-10-30', 'TODAY'],
    ['2026-10-31', 'SOON'],
    ['2026-11-02', 'SOON'], // 3 dias, virando o mês
    ['2026-11-03', null],
  ])('%s → %s', (due, expected) => expect(dueHighlight(due, today)).toBe(expected));
});

describe('isScheduled (D67)', () => {
  it('pago com data de hoje ou antes conta no saldo; depois de hoje é agendado', () => {
    expect(isScheduled({ status: 'POSTED', postedDate: '2026-10-23' }, '2026-10-23')).toBe(false);
    expect(isScheduled({ status: 'POSTED', postedDate: '2026-10-22' }, '2026-10-23')).toBe(false);
    expect(isScheduled({ status: 'POSTED', postedDate: '2026-10-24' }, '2026-10-23')).toBe(true);
    expect(isScheduled({ status: 'POSTED', postedDate: '2027-01-01' }, '2026-10-23')).toBe(true);
  });
  it('pendente e sem data não são "agendados" (têm o próprio fluxo de baixa)', () => {
    expect(isScheduled({ status: 'PENDING', postedDate: null }, '2026-10-23')).toBe(false);
    expect(isScheduled({ status: 'CANCELLED', postedDate: '2026-12-01' }, '2026-10-23')).toBe(false);
  });
});

describe('fundingNeeded (D69)', () => {
  it('saldo basta: nada a aportar; falta: só a diferença', () => {
    expect(fundingNeeded(100_000, 80_000)).toBe(0);
    expect(fundingNeeded(80_000, 80_000)).toBe(0); // zera exatamente: sem aporte
    expect(fundingNeeded(50_000, 80_000)).toBe(30_000);
    expect(fundingNeeded(0, 80_000)).toBe(80_000);
  });
  it('saldo já negativo: o aporte cobre o buraco e a conta', () => {
    expect(fundingNeeded(-10_000, 80_000)).toBe(90_000);
  });
  it('property: pagando com o aporte mínimo o saldo nunca fica negativo, e sobra 0 quando falta', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5_000_000, max: 5_000_000 }),
        fc.integer({ min: 1, max: 5_000_000 }),
        (b, a) => {
          const f = fundingNeeded(b, a);
          expect(f).toBeGreaterThanOrEqual(0);
          const after = b + f - a;
          expect(after).toBeGreaterThanOrEqual(0);
          if (f > 0) expect(after).toBe(0);
        },
      ),
    );
  });
});

describe('pendingCountsInMonth (D72): atrasado acompanha os meses seguintes até ser pago', () => {
  const today = '2026-10-17';
  it.each([
    // mês atual: tudo o que vence até o fim dele, inclusive o atrasado de meses anteriores
    ['2026-10-01', '2026-08-10', true],
    ['2026-10-01', '2026-10-05', true],
    ['2026-10-01', '2026-10-31', true],
    ['2026-10-01', '2026-11-01', false],
    // mês futuro: o que vence nele e o que já está atrasado hoje; o que ainda vai vencer no mês atual, não
    ['2026-12-01', '2026-08-10', true],
    ['2026-12-01', '2026-10-16', true],
    ['2026-12-01', '2026-10-17', false],
    ['2026-12-01', '2026-11-20', false],
    ['2026-12-01', '2026-12-31', true],
    ['2026-12-01', '2027-01-01', false],
    // mês passado: o que venceu nele ou antes e continua sem baixa
    ['2026-09-01', '2026-08-10', true],
    ['2026-09-01', '2026-09-30', true],
    ['2026-09-01', '2026-10-05', false],
  ])('mês %s, vence %s → %s', (month, due, expected) =>
    expect(pendingCountsInMonth(due, month, today)).toBe(expected),
  );

  it('o corte do atraso é o menor entre o início do mês e hoje', () => {
    expect(overdueCutoff('2026-10-01', today)).toBe('2026-10-01');
    expect(overdueCutoff('2026-12-01', today)).toBe(today);
    expect(overdueCutoff('2026-09-01', today)).toBe('2026-09-01');
  });

  it('no mês atual equivale a "vence até o fim do mês" (a previsão do saldo fecha com A receber/A pagar)', () => {
    const day = fc.integer({ min: 0, max: 400 }).map((n) => addDays('2026-07-01', n));
    fc.assert(
      fc.property(day, (due) => {
        expect(pendingCountsInMonth(due, '2026-10-01', today)).toBe(due <= '2026-10-31');
      }),
    );
  });
});
