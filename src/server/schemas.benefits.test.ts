import { describe, expect, it } from 'vitest';
import { benefitCardInput, benefitCardUpdateInput, benefitSpendInput } from './schemas';

const wallet = { name: 'Vale', monthlyCredit: '1.500,00', openingBalance: '' };
const base = {
  name: 'Multi',
  issuer: '',
  last4: '',
  creditRule: 'LAST_BUSINESS_DAY',
  creditDay: null, // o campo nem existe no formulário com "último dia útil"
  startMonth: '2026-11',
  wallets: [wallet],
};

describe('cartão de benefícios: entrada do formulário', () => {
  it('último dia útil não precisa do dia (campo ausente = null)', () => {
    const r = benefitCardInput.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.creditDay).toBeNull();
      expect(r.data.startMonth).toBe('2026-11-01');
      expect(r.data.wallets[0]).toEqual({ name: 'Vale', monthlyCredit: 150_000, openingBalance: 0 });
    }
  });

  it('dia fixo exige o dia (1 a 31)', () => {
    expect(benefitCardInput.safeParse({ ...base, creditRule: 'DAY_OF_MONTH' }).success).toBe(false);
    expect(benefitCardInput.safeParse({ ...base, creditRule: 'DAY_OF_MONTH', creditDay: '0' }).success).toBe(
      false,
    );
    expect(benefitCardInput.safeParse({ ...base, creditRule: 'DAY_OF_MONTH', creditDay: '32' }).success).toBe(
      false,
    );
    const ok = benefitCardInput.safeParse({ ...base, creditRule: 'DAY_OF_MONTH', creditDay: '5' });
    expect(ok.success && ok.data.creditDay).toBe(5);
  });

  it('carteiras: pelo menos uma, sem nome repetido, crédito > 0 e saldo de hoje não negativo', () => {
    expect(benefitCardInput.safeParse({ ...base, wallets: [] }).success).toBe(false);
    expect(
      benefitCardInput.safeParse({ ...base, wallets: [wallet, { ...wallet, name: 'VALE' }] }).success,
    ).toBe(false);
    expect(
      benefitCardInput.safeParse({ ...base, wallets: [{ ...wallet, monthlyCredit: '0,00' }] }).success,
    ).toBe(false);
    expect(
      benefitCardInput.safeParse({ ...base, wallets: [{ ...wallet, openingBalance: '-1,00' }] }).success,
    ).toBe(false);
    const r = benefitCardInput.safeParse({ ...base, wallets: [{ ...wallet, openingBalance: '800,50' }] });
    expect(r.success && r.data.wallets[0]!.openingBalance).toBe(80_050);
  });

  it('final do cartão: 4 dígitos', () => {
    expect(benefitCardInput.safeParse({ ...base, last4: '12a4' }).success).toBe(false);
    const r = benefitCardInput.safeParse({ ...base, last4: '1234' });
    expect(r.success && r.data.last4).toBe('1234');
  });

  it('edição aceita o mesmo formulário', () => {
    const id = '0b9a7f0e-6b0e-4b8e-9f43-1a2b3c4d5e6f';
    const r = benefitCardUpdateInput.safeParse({
      name: 'Multi',
      issuer: '',
      last4: '',
      creditRule: 'LAST_BUSINESS_DAY',
      creditDay: null,
      wallets: [{ id, monthlyCredit: '1.600,00' }],
    });
    expect(r.success && r.data.wallets[0]!.monthlyCredit).toBe(160_000);
  });

  it('gasto: valor > 0, carteira e categoria obrigatórias', () => {
    const id = '0b9a7f0e-6b0e-4b8e-9f43-1a2b3c4d5e6f';
    const spend = {
      walletId: id,
      amount: '25,00',
      description: 'Almoço',
      categoryId: id,
      date: '2026-10-21',
    };
    const ok = benefitSpendInput.safeParse(spend);
    expect(ok.success && ok.data.amount).toBe(2500);
    expect(benefitSpendInput.safeParse({ ...spend, amount: '0,00' }).success).toBe(false);
    expect(benefitSpendInput.safeParse({ ...spend, walletId: 'x' }).success).toBe(false);
  });
});
