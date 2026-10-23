import { describe, expect, it } from 'vitest';
import { checkNotBeforeOpening, dueHighlight, isScheduled } from './rules';

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
