import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addMonths } from '../dates';
import { amountForMonth, budgetStatus, nextAmounts, WARNING_PERCENT } from './budgets';

const rows = [
  { startMonth: '2026-09-01', amountCents: 100_000 },
  { startMonth: '2026-12-01', amountCents: 120_000 },
  { startMonth: '2027-03-01', amountCents: null },
];

describe('amountForMonth', () => {
  it('vale a linha mais recente que já começou', () => {
    expect(amountForMonth(rows, '2026-09-01')).toBe(100_000);
    expect(amountForMonth(rows, '2026-11-01')).toBe(100_000);
    expect(amountForMonth(rows, '2026-12-01')).toBe(120_000);
    expect(amountForMonth(rows, '2027-02-01')).toBe(120_000);
  });

  it('antes do primeiro mês e depois de parar, não tem orçamento', () => {
    expect(amountForMonth(rows, '2026-08-01')).toBeNull();
    expect(amountForMonth(rows, '2027-03-01')).toBeNull();
    expect(amountForMonth(rows, '2028-01-01')).toBeNull();
    expect(amountForMonth([], '2026-10-01')).toBeNull();
  });

  it('não depende da ordem das linhas', () => {
    expect(amountForMonth([...rows].reverse(), '2027-01-01')).toBe(120_000);
  });
});

describe('nextAmounts: mudar "a partir de" um mês', () => {
  it('meses anteriores ficam como estavam; o mês escolhido e os seguintes passam a valer o novo valor', () => {
    const next = nextAmounts(rows, '2026-11-01', 90_000);
    expect(next).toEqual([
      { startMonth: '2026-09-01', amountCents: 100_000 },
      { startMonth: '2026-11-01', amountCents: 90_000 },
    ]);
    expect(amountForMonth(next, '2026-10-01')).toBe(100_000);
    expect(amountForMonth(next, '2027-06-01')).toBe(90_000);
  });

  it('parar de acompanhar é um valor nulo a partir do mês', () => {
    const next = nextAmounts(rows, '2026-10-01', null);
    expect(amountForMonth(next, '2026-09-01')).toBe(100_000);
    expect(amountForMonth(next, '2026-10-01')).toBeNull();
    expect(amountForMonth(next, '2027-01-01')).toBeNull();
  });

  it('propriedade: antes do mês nada muda; do mês em diante vale o novo valor', () => {
    const month = fc.integer({ min: 0, max: 36 }).map((i) => addMonths('2026-01-01', i));
    fc.assert(
      fc.property(
        fc.array(fc.record({ startMonth: month, amountCents: fc.option(fc.integer({ min: 1, max: 1e9 })) }), {
          maxLength: 6,
        }),
        month,
        fc.option(fc.integer({ min: 1, max: 1e9 })),
        month,
        (raw, from, value, probe) => {
          // uma linha por mês, como no banco
          const current = [...new Map(raw.map((r) => [r.startMonth, r])).values()];
          const next = nextAmounts(current, from, value);
          if (probe < from) expect(amountForMonth(next, probe)).toBe(amountForMonth(current, probe));
          else expect(amountForMonth(next, probe)).toBe(value);
        },
      ),
    );
  });
});

describe('budgetStatus', () => {
  it('abaixo de 80% está ok', () => {
    expect(budgetStatus(79_999, 100_000)).toMatchObject({ level: 'ok', percent: 79, remainingCents: 20_001 });
  });

  it('a partir de 80% e até o limite, perto do limite', () => {
    expect(budgetStatus(80_000, 100_000).level).toBe('warning');
    expect(budgetStatus(100_000, 100_000)).toMatchObject({
      level: 'warning',
      percent: 100,
      remainingCents: 0,
    });
  });

  it('passou do limite: o que passou aparece como restante negativo', () => {
    expect(budgetStatus(100_001, 100_000)).toMatchObject({ level: 'over', remainingCents: -1 });
    expect(budgetStatus(250_000, 100_000).percent).toBe(250);
  });

  it('gasto negativo (estorno maior que as compras) conta como zero no %', () => {
    expect(budgetStatus(-5_000, 100_000)).toMatchObject({ level: 'ok', percent: 0, remainingCents: 105_000 });
  });

  it('propriedade: o nível só sobe quando o gasto sobe, e bate com os limites em centavos', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e10 }),
        fc.integer({ min: 0, max: 2e10 }),
        fc.integer({ min: 0, max: 2e10 }),
        (limit, a, b) => {
          const order = { ok: 0, warning: 1, over: 2 } as const;
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(order[budgetStatus(lo, limit).level]).toBeLessThanOrEqual(
            order[budgetStatus(hi, limit).level],
          );
          const s = budgetStatus(hi, limit);
          expect(s.level === 'over').toBe(hi > limit);
          expect(s.level !== 'ok').toBe(hi * 100 >= limit * WARNING_PERCENT);
          expect(s.remainingCents).toBe(limit - hi);
        },
      ),
    );
  });
});
