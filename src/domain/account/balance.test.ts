import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  INFLOW_KINDS,
  OUTFLOW_KINDS,
  balanceAdjustment,
  computeBalance,
  signedAmount,
  type BalanceEntry,
  type TransactionKind,
} from './balance';

const ALL_KINDS: TransactionKind[] = [...INFLOW_KINDS, ...OUTFLOW_KINDS];

const posted = (kind: TransactionKind, amountCents: number, postedDate = '2026-10-10'): BalanceEntry => ({
  kind,
  status: 'POSTED',
  amountCents,
  postedDate,
  deleted: false,
});

describe('signedAmount', () => {
  it.each(INFLOW_KINDS)('%s entra no caixa', (k) => expect(signedAmount(k, 100)).toBe(100));
  it.each(OUTFLOW_KINDS)('%s sai do caixa', (k) => expect(signedAmount(k, 100)).toBe(-100));
  it('valor sempre positivo', () => {
    expect(() => signedAmount('EXPENSE', 0)).toThrow();
    expect(() => signedAmount('EXPENSE', -1)).toThrow();
    expect(() => signedAmount('EXPENSE', 1.5)).toThrow();
  });
});

describe('computeBalance', () => {
  it('fórmula canônica: inicial + entradas − saídas, só POSTED e não deletado', () => {
    const entries: BalanceEntry[] = [
      posted('INCOME', 500_000),
      posted('EXPENSE', 12_345),
      posted('INVOICE_PAYMENT', 3_334), // sai do caixa (não é gasto, mas mexe no saldo)
      { ...posted('EXPENSE', 99_999), status: 'PENDING', postedDate: null },
      { ...posted('EXPENSE', 77_777), status: 'CANCELLED' },
      { ...posted('INCOME', 88_888), deleted: true },
      posted('ADJUSTMENT_IN', 10),
    ];
    expect(computeBalance(100_000, entries)).toBe(100_000 + 500_000 - 12_345 - 3_334 + 10);
  });

  it('saldo inicial negativo', () => {
    expect(computeBalance(-15_000, [posted('INCOME', 20_000)])).toBe(5_000);
  });

  it('corte por data: só posted_date ≤ asOf', () => {
    const entries = [posted('INCOME', 1000, '2026-10-01'), posted('EXPENSE', 300, '2026-10-15')];
    expect(computeBalance(0, entries, '2026-10-14')).toBe(1000);
    expect(computeBalance(0, entries, '2026-10-15')).toBe(700);
  });

  const entryArb = fc.record({
    kind: fc.constantFrom(...ALL_KINDS),
    status: fc.constantFrom('PENDING' as const, 'POSTED' as const, 'CANCELLED' as const),
    amountCents: fc.integer({ min: 1, max: 100_000_000 }),
    postedDate: fc.constant('2026-10-10'),
    deleted: fc.boolean(),
  });

  it('property: independe da ordem dos lançamentos', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e9, max: 1e9 }),
        fc.array(entryArb, { maxLength: 60 }),
        (opening, es) => {
          expect(computeBalance(opening, [...es].reverse())).toBe(computeBalance(opening, es));
        },
      ),
    );
  });

  it('property: Σ entradas − Σ saídas confere com somas separadas', () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 60 }), (es) => {
        const live = es.filter((e) => e.status === 'POSTED' && !e.deleted);
        const ins = live.filter((e) => (INFLOW_KINDS as readonly string[]).includes(e.kind));
        const outs = live.filter((e) => !(INFLOW_KINDS as readonly string[]).includes(e.kind));
        const sum = (xs: typeof es) => xs.reduce((s, e) => s + e.amountCents, 0);
        expect(computeBalance(0, es)).toBe(sum(ins) - sum(outs));
      }),
    );
  });
});

describe('balanceAdjustment', () => {
  it('banco maior → ajuste de entrada', () =>
    expect(balanceAdjustment(10_050, 10_000)).toEqual({ kind: 'ADJUSTMENT_IN', amountCents: 50 }));
  it('banco menor → ajuste de saída', () =>
    expect(balanceAdjustment(9_000, 10_000)).toEqual({ kind: 'ADJUSTMENT_OUT', amountCents: 1_000 }));
  it('bate → sem ajuste', () => expect(balanceAdjustment(10_000, 10_000)).toBeNull());

  it('property: aplicar o ajuste faz o saldo bater exatamente', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e11, max: 1e11 }),
        fc.integer({ min: -1e11, max: 1e11 }),
        (statement, computed) => {
          const adj = balanceAdjustment(statement, computed);
          const after = adj ? computed + signedAmount(adj.kind, adj.amountCents) : computed;
          expect(after).toBe(statement);
        },
      ),
    );
  });
});
