import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkNotBeforeOpening, dueHighlight, fundingNeeded, isScheduled } from './rules';

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
