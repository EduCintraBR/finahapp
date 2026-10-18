import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  anticipatable,
  buildInstallments,
  checkPartialRefund,
  defaultAnticipationSelection,
  planAnticipation,
  planCancelPurchase,
  type PlanItem,
} from './purchases';

describe('buildInstallments', () => {
  it('R$ 100 em 3x, resto na 1ª', () => {
    expect(buildInstallments(10_000, 3)).toEqual([
      { number: 1, amountCents: 3334 },
      { number: 2, amountCents: 3333 },
      { number: 3, amountCents: 3333 },
    ]);
  });

  it('onboarding: só a partir da parcela atual', () => {
    expect(buildInstallments(100_000, 10, 9)).toEqual([
      { number: 9, amountCents: 10_000 },
      { number: 10, amountCents: 10_000 },
    ]);
    expect(() => buildInstallments(100_000, 10, 11)).toThrow('parcela atual');
  });

  it('property: com firstTracked = 1, Σ parcelas = total; numeração contínua', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 72 })
          .chain((n) => fc.tuple(fc.integer({ min: n, max: 1e12 }), fc.constant(n))),
        ([total, n]) => {
          const lines = buildInstallments(total, n);
          expect(lines.reduce((s, l) => s + l.amountCents, 0)).toBe(total);
          expect(lines.map((l) => l.number)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
        },
      ),
    );
  });

  it('property: onboarding = sufixo exato do plano completo', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: 72 })
          .chain((n) =>
            fc.tuple(fc.integer({ min: n, max: 1e10 }), fc.constant(n), fc.integer({ min: 1, max: n })),
          ),
        ([total, n, first]) => {
          expect(buildInstallments(total, n, first)).toEqual(buildInstallments(total, n).slice(first - 1));
        },
      ),
    );
  });
});

const item = (over: Partial<PlanItem> & Pick<PlanItem, 'id'>): PlanItem => ({
  kind: 'INSTALLMENT',
  status: 'ACTIVE',
  installmentNumber: 1,
  amountCents: 3333,
  invoiceClosed: false,
  ...over,
});

// R$ 100 em 3x: parcela 1 já fechou, 2 e 3 em faturas abertas/futuras
const plan3x = [
  item({ id: 'p1', installmentNumber: 1, amountCents: 3334, invoiceClosed: true }),
  item({ id: 'p2', installmentNumber: 2 }),
  item({ id: 'p3', installmentNumber: 3 }),
];

describe('antecipação', () => {
  it('só parcelas ativas de faturas abertas; padrão = as últimas n', () => {
    expect(anticipatable(plan3x).map((i) => i.id)).toEqual(['p2', 'p3']);
    expect(defaultAnticipationSelection(plan3x, 1).map((i) => i.id)).toEqual(['p3']);
    expect(defaultAnticipationSelection(plan3x, 5).map((i) => i.id)).toEqual(['p2', 'p3']);
  });

  it('bruto = Σ parcelas, desconto = bruto − pago', () => {
    expect(planAnticipation(plan3x, ['p3'], 3200)).toEqual({
      grossCents: 3333,
      discountCents: 133,
      paidCents: 3200,
    });
    expect(planAnticipation(plan3x, ['p2', 'p3'], 6666)).toEqual({
      grossCents: 6666,
      discountCents: 0,
      paidCents: 6666,
    });
  });

  it('recusas em pt-BR', () => {
    expect(planAnticipation(plan3x, [], 1)).toHaveProperty('error');
    expect(planAnticipation(plan3x, ['p1'], 1000)).toEqual({
      error: 'Só dá para antecipar parcelas de faturas que ainda não fecharam.',
    });
    expect(planAnticipation(plan3x, ['p3'], 4000)).toHaveProperty('error');
    expect(planAnticipation(plan3x, ['p3'], 0)).toHaveProperty('error');
  });

  it('property: bruto − desconto = pago, sempre', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6666 }), (paid) => {
        const r = planAnticipation(plan3x, ['p2', 'p3'], paid);
        if ('error' in r) throw new Error(r.error);
        expect(r.grossCents - r.discountCents).toBe(r.paidCents);
        expect(r.discountCents).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});

describe('estornos', () => {
  it('Modo A: até o que ainda não foi estornado', () => {
    expect(checkPartialRefund(3000, 10_000, 0)).toBeNull();
    expect(checkPartialRefund(10_000, 10_000, 1)).toMatch('não pode passar');
    expect(checkPartialRefund(0, 10_000, 0)).toMatch('maior que zero');
  });

  it('Modo B simples: cancela o que não foi cobrado, credita o que foi; bruto abate a compra inteira', () => {
    expect(
      planCancelPurchase({
        items: plan3x,
        purchaseTotal: 10_000,
        trackedTotal: 10_000,
        onboarding: false,
        directAnticipationsPaid: 0,
        previousRefundRecords: 0,
      }),
    ).toEqual({ cancelItemIds: ['p2', 'p3'], creditCents: 3334, grossRefundCents: 10_000 });
  });

  it('Modo B com antecipação avulsa já paga: o valor pago volta como crédito (D26)', () => {
    const items = [...plan3x.slice(0, 2), item({ id: 'p3', installmentNumber: 3, status: 'ANTICIPATED' })];
    expect(
      planCancelPurchase({
        items,
        purchaseTotal: 10_000,
        trackedTotal: 10_000,
        onboarding: false,
        directAnticipationsPaid: 3200,
        previousRefundRecords: 0,
      }),
    ).toEqual({ cancelItemIds: ['p2'], creditCents: 3334 + 3200, grossRefundCents: 10_000 });
  });

  it('Modo B depois de um Modo A: desconta o crédito e o estorno anteriores', () => {
    const items = [
      ...plan3x,
      item({
        id: 'r1',
        kind: 'REFUND_CREDIT',
        installmentNumber: null,
        amountCents: -1000,
        invoiceClosed: true,
      }),
    ];
    expect(
      planCancelPurchase({
        items,
        purchaseTotal: 10_000,
        trackedTotal: 10_000,
        onboarding: false,
        directAnticipationsPaid: 0,
        previousRefundRecords: 1000,
      }),
    ).toEqual({ cancelItemIds: ['p2', 'p3'], creditCents: 2334, grossRefundCents: 9000 });
  });

  it('Modo B em compra de onboarding: bruto abate só a parte conhecida', () => {
    const r = planCancelPurchase({
      items: [item({ id: 'p9', installmentNumber: 9, amountCents: 10_000 })],
      purchaseTotal: 100_000,
      trackedTotal: 20_000,
      onboarding: true,
      directAnticipationsPaid: 0,
      previousRefundRecords: 0,
    });
    expect(r).toEqual({ cancelItemIds: ['p9'], creditCents: 0, grossRefundCents: 20_000 });
  });
});
