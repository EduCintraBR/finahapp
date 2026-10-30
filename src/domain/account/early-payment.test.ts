import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isEarlyPayment, paymentAdjustment } from './early-payment';

describe('isEarlyPayment', () => {
  it('vence em novembro e foi pago em outubro → antecipado', () => {
    expect(isEarlyPayment('2026-11-01', '2026-10-30')).toBe(true);
  });
  it('mesmo mês, antes ou depois do vencimento → baixa normal', () => {
    expect(isEarlyPayment('2026-10-25', '2026-10-20')).toBe(false);
    expect(isEarlyPayment('2026-10-17', '2026-10-30')).toBe(false);
    expect(isEarlyPayment('2026-10-17', '2026-10-17')).toBe(false);
  });
  it('pago num mês depois do vencimento (atraso) → baixa normal', () => {
    expect(isEarlyPayment('2026-10-28', '2026-11-03')).toBe(false);
  });
  it('vira o ano', () => {
    expect(isEarlyPayment('2027-01-05', '2026-12-31')).toBe(true);
  });
});

describe('paymentAdjustment', () => {
  it('a parcela da Shopee: R$ 217,80 previstos, R$ 215,93 pagos → desconto de R$ 1,87', () => {
    expect(paymentAdjustment(21_780, 21_593)).toEqual({ discountCents: 187, surchargeCents: 0 });
  });
  it('pagou a mais → acréscimo', () => {
    expect(paymentAdjustment(10_000, 10_250)).toEqual({ discountCents: 0, surchargeCents: 250 });
  });
  it('pagou o previsto → sem diferença', () => {
    expect(paymentAdjustment(10_000, 10_000)).toEqual({ discountCents: 0, surchargeCents: 0 });
  });
  it('invariante: previsto − desconto + acréscimo = pago, e um dos dois é sempre zero', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        (s, p) => {
          const { discountCents, surchargeCents } = paymentAdjustment(s, p);
          expect(s - discountCents + surchargeCents).toBe(p);
          expect(discountCents === 0 || surchargeCents === 0).toBe(true);
        },
      ),
    );
  });
});
