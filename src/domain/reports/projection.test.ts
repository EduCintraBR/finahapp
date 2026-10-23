import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { accumulate, projectMonth, subscriptionsDueIn, type ProjectionTemplate } from './projection';

const tpl = (over: Partial<ProjectionTemplate> = {}): ProjectionTemplate => ({
  id: 't',
  direction: 'EXPENSE',
  type: 'FIXED',
  amountCents: 200_000,
  dayOfMonth: 10,
  startMonth: '2026-10-01',
  endMonth: null,
  isActive: true,
  paymentMethod: 'BOLETO',
  card: null,
  ...over,
});
const nubank = { rule: { closingDay: 9, dueDay: 16 }, invoices: [] };

describe('projectMonth (D41)', () => {
  it('receitas previstas − (fixos + recorrentes + faturas + assinaturas)', () => {
    const p = projectMonth({
      month: '2026-12-01',
      today: '2026-10-18',
      templates: [
        tpl({ direction: 'INCOME', amountCents: 800_000 }),
        tpl({ amountCents: 200_000 }), // aluguel
        tpl({ type: 'RECURRING_VARIABLE', amountCents: 25_000 }), // luz
        tpl({ amountCents: 9_999, endMonth: '2026-11-01' }), // encerrado antes de dezembro
        tpl({ amountCents: 5_590, dayOfMonth: 15, paymentMethod: 'CREDIT_CARD', card: nubank }), // assinatura
      ],
      invoicesDueCents: 150_000,
    });
    expect(p).toEqual({
      month: '2026-12-01',
      incomeCents: 800_000,
      fixedCents: 200_000,
      variableCents: 25_000,
      invoicesCents: 150_000,
      loansCents: 0,
      subscriptionsCents: 5_590, // cobrança de 15/11 cai na fatura que vence em 16/12
      resultCents: 800_000 - (200_000 + 25_000 + 150_000 + 5_590),
    });
  });

  it('parcelas de empréstimo pendentes do mês saem do resultado (D66)', () => {
    const p = projectMonth({
      month: '2026-12-01',
      today: '2026-10-18',
      templates: [tpl({ direction: 'INCOME', amountCents: 800_000 })],
      invoicesDueCents: 0,
      loansDueCents: 120_050,
    });
    expect(p.loansCents).toBe(120_050);
    expect(p.resultCents).toBe(800_000 - 120_050);
  });

  it('template que só começa depois não entra', () => {
    const p = projectMonth({
      month: '2026-11-01',
      today: '2026-10-18',
      templates: [tpl({ startMonth: '2027-01-01' })],
      invoicesDueCents: 0,
    });
    expect(p.resultCents).toBe(0);
  });
});

describe('subscriptionsDueIn (D39)', () => {
  const netflix = tpl({ amountCents: 5_590, dayOfMonth: 15, paymentMethod: 'CREDIT_CARD', card: nubank });
  it('entra no mês em que a fatura da cobrança vence', () => {
    expect(subscriptionsDueIn(netflix, '2026-12-01', '2026-10-18')).toBe(5_590); // cobrança 15/11
    expect(subscriptionsDueIn(netflix, '2027-01-01', '2026-10-18')).toBe(5_590); // cobrança 15/12
  });
  it('cobrança já gerada (data ≤ hoje) não conta de novo', () => {
    expect(subscriptionsDueIn(netflix, '2026-11-01', '2026-10-18')).toBe(0); // 15/10 já virou item da fatura de novembro
  });
  it('cobrança antes do fechamento cai na fatura do mesmo mês', () => {
    const early = tpl({ amountCents: 1000, dayOfMonth: 5, paymentMethod: 'CREDIT_CARD', card: nubank });
    expect(subscriptionsDueIn(early, '2026-11-01', '2026-10-18')).toBe(1000); // 05/11 < fecha 09/11 → vence 16/11
  });
});

describe('accumulate (D40)', () => {
  it('saldo estimado mês a mês', () => {
    expect(accumulate(100_000, [50_000, -30_000, 10_000])).toEqual([150_000, 120_000, 130_000]);
  });
  it('property: o último acumulado = saldo inicial + soma dos resultados', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e9, max: 1e9 }),
        fc.array(fc.integer({ min: -1e8, max: 1e8 }), { minLength: 1, maxLength: 24 }),
        (s, rs) => {
          expect(accumulate(s, rs).at(-1)).toBe(s + rs.reduce((a, b) => a + b, 0));
        },
      ),
    );
  });
});
