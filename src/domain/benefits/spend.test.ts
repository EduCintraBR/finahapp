import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isPlainBenefitSpend, spendEditLimit } from './spend';

const plain = {
  kind: 'EXPENSE',
  benefitWalletId: 'w1',
  dueDate: null,
  recurringTemplateId: null,
  anticipatesTransactionId: null,
};

describe('isPlainBenefitSpend', () => {
  it('gasto lançado direto na carteira é editável', () => {
    expect(isPlainBenefitSpend(plain)).toBe(true);
  });

  it('crédito, gasto fora do benefício e conta paga com a carteira não são', () => {
    expect(isPlainBenefitSpend({ ...plain, kind: 'INCOME' })).toBe(false);
    expect(isPlainBenefitSpend({ ...plain, benefitWalletId: null })).toBe(false);
    expect(isPlainBenefitSpend({ ...plain, dueDate: '2026-10-10' })).toBe(false);
    expect(isPlainBenefitSpend({ ...plain, recurringTemplateId: 't1' })).toBe(false);
    expect(isPlainBenefitSpend({ ...plain, anticipatesTransactionId: 'x' })).toBe(false);
  });
});

describe('spendEditLimit', () => {
  it('na mesma carteira, o valor do próprio gasto volta para o limite', () => {
    expect(spendEditLimit({ walletId: 'w1', amountCents: 2_500 }, 'w1', 7_500)).toBe(10_000);
  });

  it('em outra carteira, só o saldo dela', () => {
    expect(spendEditLimit({ walletId: 'w1', amountCents: 2_500 }, 'w2', 7_500)).toBe(7_500);
  });

  it('propriedade: editar até o limite nunca deixa nenhuma das carteiras negativa', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }), // valor atual do gasto
        fc.integer({ min: 0, max: 10_000_000 }), // saldo atual da carteira do gasto (já descontado o gasto)
        fc.integer({ min: 0, max: 10_000_000 }), // saldo da outra carteira
        fc.boolean(), // troca de carteira?
        fc.double({ min: 0, max: 1, noNaN: true }),
        (amount, ownBalance, otherBalance, move, f) => {
          const spend = { walletId: 'w1', amountCents: amount };
          const target = move ? 'w2' : 'w1';
          const limit = spendEditLimit(spend, target, move ? otherBalance : ownBalance);
          const edited = Math.floor(limit * f);
          // saldo de cada carteira depois da edição: devolve o valor antigo à w1 e tira o novo da carteira escolhida
          const w1 = ownBalance + amount - (target === 'w1' ? edited : 0);
          const w2 = otherBalance - (target === 'w2' ? edited : 0);
          expect(w1).toBeGreaterThanOrEqual(0);
          expect(w2).toBeGreaterThanOrEqual(0);
          // e a soma das carteiras muda exatamente pela diferença do valor
          expect(w1 + w2).toBe(ownBalance + otherBalance + amount - edited);
        },
      ),
    );
  });
});
