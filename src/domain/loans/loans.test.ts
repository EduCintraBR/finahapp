import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocatePayment, buildLoanInstallments, summarizeLoan } from './loans';

describe('buildLoanInstallments', () => {
  it('divide o total (com juros) em parcelas mensais; o resto do arredondamento vai na 1ª', () => {
    expect(buildLoanInstallments(10_000, 3, '2026-11-10')).toEqual([
      { number: 1, amountCents: 3334, dueDate: '2026-11-10' },
      { number: 2, amountCents: 3333, dueDate: '2026-12-10' },
      { number: 3, amountCents: 3333, dueDate: '2027-01-10' },
    ]);
  });

  it('dia 31 (ou 30) cai no último dia dos meses curtos e volta ao dia certo depois', () => {
    const dates = buildLoanInstallments(300, 4, '2026-12-31').map((i) => i.dueDate);
    expect(dates).toEqual(['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
  });

  it('recusa total menor que uma parcela de R$ 0,01 e número de parcelas inválido', () => {
    expect(() => buildLoanInstallments(2, 3, '2026-11-10')).toThrow('R$ 0,01');
    expect(() => buildLoanInstallments(1000, 0, '2026-11-10')).toThrow('parcelas');
    expect(() => buildLoanInstallments(1000, 121, '2026-11-10')).toThrow('parcelas');
  });

  it('property: Σ parcelas = total, datas mensais crescentes, nenhuma parcela zerada', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 120 }),
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.integer({ min: 1, max: 28 }),
        (count, extra, day) => {
          const total = count + extra;
          const parcels = buildLoanInstallments(total, count, `2026-11-${String(day).padStart(2, '0')}`);
          expect(parcels).toHaveLength(count);
          expect(parcels.reduce((s, p) => s + p.amountCents, 0)).toBe(total);
          expect(parcels.every((p) => p.amountCents >= 1)).toBe(true);
          for (let i = 1; i < parcels.length; i++)
            expect(parcels[i]!.dueDate > parcels[i - 1]!.dueDate).toBe(true);
          expect(parcels.map((p) => p.number)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
        },
      ),
    );
  });
});

describe('allocatePayment (várias parcelas pagas de uma vez)', () => {
  it('rateia o valor pago proporcionalmente ao valor de cada parcela', () => {
    expect(allocatePayment([10_000, 10_000, 10_000], 27_000)).toEqual([9000, 9000, 9000]);
    expect(allocatePayment([10_000, 20_000], 27_000)).toEqual([9000, 18_000]);
  });

  it('o resto dos centavos vai na 1ª parcela e a soma é exata', () => {
    const r = allocatePayment([3333, 3333, 3334], 9_000);
    expect(r.reduce((s, v) => s + v, 0)).toBe(9_000);
    expect(r).toEqual([3001, 2999, 3000]); // proporcional ao valor de cada parcela; o resto na 1ª
    const r2 = allocatePayment([100, 100, 100], 100);
    expect(r2.reduce((s, v) => s + v, 0)).toBe(100);
    expect(r2[0]).toBeGreaterThanOrEqual(r2[1]!);
  });

  it('pagar mais que o programado (atraso) também rateia', () => {
    expect(allocatePayment([10_000], 10_500)).toEqual([10_500]);
    const r = allocatePayment([10_000, 10_000], 21_000);
    expect(r.reduce((s, v) => s + v, 0)).toBe(21_000);
  });

  it('recusa valor que não dá pelo menos R$ 0,01 por parcela, e entradas inválidas', () => {
    expect(() => allocatePayment([100, 100, 100], 2)).toThrow('R$ 0,01');
    expect(() => allocatePayment([], 100)).toThrow('parcela');
    expect(() => allocatePayment([100], 0)).toThrow('maior que zero');
  });

  it('property: Σ rateio = valor pago, nenhuma parcela zerada, mesma ordem', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 50_000_000 }), { minLength: 1, maxLength: 60 }),
        fc.integer({ min: 0, max: 3_000_000_000 }),
        (scheduled, extra) => {
          const paid = scheduled.length + extra;
          const r = allocatePayment(scheduled, paid);
          expect(r).toHaveLength(scheduled.length);
          expect(r.reduce((s, v) => s + v, 0)).toBe(paid);
          expect(r.every((v) => v >= 1)).toBe(true);
        },
      ),
    );
  });
});

describe('summarizeLoan', () => {
  const mk = (
    n: number,
    scheduled: number,
    paid: number | null,
    due: string,
    paidDate: string | null = null,
  ) => ({
    number: n,
    scheduledCents: scheduled,
    paidCents: paid,
    dueDate: due,
    paidDate,
  });

  it('pago, restante, economia (adiantou com desconto) e acréscimo (atrasou e pagou mais)', () => {
    const s = summarizeLoan(
      [
        mk(1, 10_000, 10_000, '2026-11-10', '2026-11-10'),
        mk(2, 10_000, 9_000, '2026-12-10', '2026-11-20'), // adiantada com desconto de 10,00
        mk(3, 10_000, 10_400, '2027-01-10', '2027-01-15'), // atrasada, pagou 4,00 a mais
        mk(4, 10_000, null, '2027-02-10'),
        mk(5, 10_050, null, '2027-03-10'),
      ],
      '2027-02-01',
    );
    expect(s.paidCents).toBe(29_400);
    expect(s.remainingCents).toBe(20_050);
    expect(s.paidCount).toBe(3);
    expect(s.savingsCents).toBe(1_000);
    expect(s.lateFeesCents).toBe(400);
    expect(s.totalScheduledCents).toBe(50_050);
    expect(s.nextDueDate).toBe('2027-02-10');
    expect(s.overdueCount).toBe(0);
    expect(s.settled).toBe(false);
  });

  it('atrasadas, e quitado quando todas estão pagas', () => {
    const open = summarizeLoan(
      [mk(1, 100, null, '2026-10-01'), mk(2, 100, null, '2026-11-01')],
      '2026-10-21',
    );
    expect(open.overdueCount).toBe(1);
    const done = summarizeLoan([mk(1, 100, 100, '2026-10-01', '2026-10-01')], '2026-10-21');
    expect(done.settled).toBe(true);
    expect(done.nextDueDate).toBeNull();
    expect(done.remainingCents).toBe(0);
  });

  it('a economia de uma parcela adiantada só conta se ela foi paga abaixo do programado', () => {
    const s = summarizeLoan([mk(1, 5000, 4000, '2027-01-10', '2026-10-21')], '2026-10-21');
    expect(s.savingsCents).toBe(1000);
    expect(s.lateFeesCents).toBe(0);
  });
});
