import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { pendingPayableCents } from './pending-total';

describe('pendingPayableCents (total a pagar da lista de pendentes)', () => {
  it('lista vazia = 0', () => {
    expect(pendingPayableCents([])).toBe(0);
  });

  it('soma só as saídas; entradas pendentes (a receber) ficam de fora', () => {
    expect(
      pendingPayableCents([
        { kind: 'EXPENSE', amountCents: 71715 },
        { kind: 'EXPENSE', amountCents: 162100 },
        { kind: 'INCOME', amountCents: 500000 },
        { kind: 'EXPENSE', amountCents: 990 },
      ]),
    ).toBe(234805);
  });

  it('property: é a soma exata em centavos das saídas, em qualquer ordem', () => {
    const entry = fc.record({
      kind: fc.constantFrom('EXPENSE', 'INCOME'),
      amountCents: fc.integer({ min: 1, max: 100_000_000 }),
    });
    fc.assert(
      fc.property(fc.array(entry, { maxLength: 40 }), (entries) => {
        const expected = entries.filter((e) => e.kind === 'EXPENSE').reduce((s, e) => s + e.amountCents, 0);
        expect(pendingPayableCents(entries)).toBe(expected);
        expect(pendingPayableCents([...entries].reverse())).toBe(expected);
      }),
    );
  });
});
