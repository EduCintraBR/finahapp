import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, addMonths, compareDates, diffDays, type ISODate } from '../dates';
import { buildInstallments } from './purchases';
import { ruleInvoice } from './invoices';
import {
  checkStoreCreditTerms,
  formatPercent,
  purchaseInterest,
  resolveStoreCreditInvoice,
  type StoreCreditInvoice,
} from './store-credit';

const shopee = { firstDueDays: 40, closeBeforeDays: 7 };
const inv = (dueDate: ISODate, settled: boolean, closeBefore = 7): StoreCreditInvoice => ({
  referenceMonth: `${dueDate.slice(0, 7)}-01`,
  closingDate: addDays(dueDate, -closeBefore),
  dueDate,
  settled,
});

describe('ruleInvoice do crediário (D73)', () => {
  it('fecha N dias antes do vencimento, no dia do ciclo', () => {
    expect(ruleInvoice('2027-01-01', { dueDay: 11, closeBeforeDays: 7 })).toEqual({
      referenceMonth: '2027-01-01',
      closingDate: '2027-01-04',
      dueDate: '2027-01-11',
    });
  });

  it('dia 31 em mês curto: vence no último dia e fecha N dias antes', () => {
    expect(ruleInvoice('2027-02-01', { dueDay: 31, closeBeforeDays: 7 })).toMatchObject({
      closingDate: '2027-02-21',
      dueDate: '2027-02-28',
    });
  });
});

describe('resolveStoreCreditInvoice (D73)', () => {
  it('primeira compra: a fatura vence 40 dias depois e fecha 7 antes', () => {
    expect(resolveStoreCreditInvoice('2026-11-01', [], 1, shopee)).toEqual({
      window: { referenceMonth: '2026-12-01', closingDate: '2026-12-04', dueDate: '2026-12-11' },
      anchorDay: 11,
      newCycle: true,
    });
  });

  it('compras seguintes antes do fechamento vão para a mesma fatura', () => {
    const r = resolveStoreCreditInvoice('2026-11-20', [inv('2026-12-11', false)], 11, shopee);
    expect(r.window.dueDate).toBe('2026-12-11');
    expect(r.newCycle).toBe(false);
  });

  it('depois do fechamento e antes do vencimento: fatura do mês seguinte, mesmo dia', () => {
    for (const settled of [false, true]) {
      const r = resolveStoreCreditInvoice('2026-12-05', [inv('2026-12-11', settled)], 11, shopee);
      expect(r.window).toEqual({
        referenceMonth: '2027-01-01',
        closingDate: '2027-01-04',
        dueDate: '2027-01-11',
      });
      expect(r.newCycle).toBe(false);
    }
  });

  it('fatura vencida sem pagar: o ciclo continua mensal', () => {
    const r = resolveStoreCreditInvoice('2026-12-20', [inv('2026-12-11', false)], 11, shopee);
    expect(r.window.dueDate).toBe('2027-01-11');
    expect(r.newCycle).toBe(false);
  });

  it('tudo vencido e pago: a próxima compra abre um ciclo novo de 40 dias', () => {
    const r = resolveStoreCreditInvoice(
      '2026-12-20',
      [inv('2026-11-11', true), inv('2026-12-11', true)],
      11,
      shopee,
    );
    expect(r).toEqual({
      window: { referenceMonth: '2027-01-01', closingDate: '2027-01-22', dueDate: '2027-01-29' },
      anchorDay: 29,
      newCycle: true,
    });
  });

  it('parcelas futuras mantêm o ciclo ativo mesmo com as faturas passadas pagas', () => {
    const r = resolveStoreCreditInvoice(
      '2027-01-06',
      [inv('2026-12-11', true), inv('2027-01-11', true), inv('2027-02-11', false)],
      11,
      shopee,
    );
    expect(r.window.dueDate).toBe('2027-02-11');
  });

  it('respeita as datas editadas da fatura materializada', () => {
    const edited: StoreCreditInvoice = {
      referenceMonth: '2027-01-01',
      closingDate: '2027-01-02',
      dueDate: '2027-01-11',
      settled: false,
    };
    const r = resolveStoreCreditInvoice('2027-01-03', [inv('2026-12-11', false), edited], 11, shopee);
    expect(r.window.dueDate).toBe('2027-02-11');
  });

  it('propriedade: a fatura sempre fecha depois da compra e vence depois do fechamento', () => {
    const day = fc.integer({ min: 0, max: 800 }).map((n) => addDays('2026-01-01', n));
    fc.assert(
      fc.property(
        day,
        fc.integer({ min: 2, max: 120 }),
        fc.integer({ min: 1, max: 119 }),
        fc.array(fc.tuple(fc.integer({ min: -6, max: 6 }), fc.boolean()), { maxLength: 6 }),
        fc.integer({ min: 1, max: 31 }),
        (purchase, firstDueDays, closeBeforeDays, rel, anchorDay) => {
          fc.pre(closeBeforeDays < firstDueDays && closeBeforeDays <= 25);
          const months = [...new Set(rel.map(([m]) => m))];
          const invoices = months.map((m) => {
            const w = ruleInvoice(addMonths(purchase, m), { dueDay: anchorDay, closeBeforeDays });
            return { ...w, settled: rel.find(([k]) => k === m)![1] };
          });
          const r = resolveStoreCreditInvoice(purchase, invoices, anchorDay, {
            firstDueDays,
            closeBeforeDays,
          });
          expect(compareDates(r.window.closingDate, purchase)).toBe(1);
          expect(compareDates(r.window.dueDate, r.window.closingDate)).toBe(1);
          if (r.newCycle) expect(diffDays(r.window.dueDate, purchase)).toBe(firstDueDays);
        },
      ),
    );
  });
});

describe('checkStoreCreditTerms', () => {
  it('aceita o padrão e recusa prazos sem sentido', () => {
    expect(checkStoreCreditTerms(shopee)).toBeNull();
    expect(checkStoreCreditTerms({ firstDueDays: 40, closeBeforeDays: 40 })).toMatch(/fechar depois/);
    expect(checkStoreCreditTerms({ firstDueDays: 40, closeBeforeDays: 0 })).toMatch(/1 dia/);
    expect(checkStoreCreditTerms({ firstDueDays: 1, closeBeforeDays: 0 })).toMatch(/Prazo/);
    expect(checkStoreCreditTerms({ firstDueDays: 121, closeBeforeDays: 7 })).toMatch(/Prazo/);
  });
});

describe('purchaseInterest (D73)', () => {
  const schedule = (total: number, count: number, firstDue: ISODate) =>
    buildInstallments(total, count).map((l, i) => ({
      amountCents: l.amountCents,
      dueDate: addMonths(firstDue, i),
    }));

  it('R$ 100 que viram R$ 105 em 1× daqui a 30 dias: 5% e 5% a.m.', () => {
    const r = purchaseInterest(10_000, [{ amountCents: 10_500, dueDate: '2026-12-01' }], '2026-11-01');
    expect(r.extraCents).toBe(500);
    expect(r.percent).toBe(5);
    expect(r.monthlyRate).toBeCloseTo(5, 6);
  });

  it('R$ 100 que viram R$ 115 em 3×: acréscimo de R$ 15 e a taxa devolve o valor original', () => {
    const parcels = schedule(11_500, 3, '2026-12-11');
    const r = purchaseInterest(10_000, parcels, '2026-11-01');
    expect(r.extraCents).toBe(1_500);
    expect(r.percent).toBe(15);
    const i = r.monthlyRate! / 100;
    const pv = parcels.reduce(
      (s, p) => s + p.amountCents / Math.pow(1 + i, diffDays(p.dueDate, '2026-11-01') / 30),
      0,
    );
    expect(pv).toBeCloseTo(10_000, 4);
    expect(formatPercent(r.monthlyRate!)).toMatch(/^\d+,\d{2}%$/);
  });

  it('sem acréscimo: taxa nula', () => {
    expect(purchaseInterest(10_000, schedule(10_000, 2, '2026-12-11'), '2026-11-01')).toEqual({
      extraCents: 0,
      percent: 0,
      monthlyRate: null,
    });
  });

  it('total menor que o original é recusado', () => {
    expect(() => purchaseInterest(10_000, schedule(9_000, 2, '2026-12-11'), '2026-11-01')).toThrow(
      /menor que o valor original/,
    );
  });

  it('propriedade: o acréscimo fecha no centavo e mais juros = taxa maior', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1_000_000 }),
        fc.integer({ min: 1, max: 50_000 }),
        fc.integer({ min: 1, max: 24 }),
        (original, extra, count) => {
          const parcels = schedule(original + extra, count, '2026-12-11');
          const a = purchaseInterest(original, parcels, '2026-11-01');
          // mesmas datas, 1 centavo a mais em cada parcela
          const more = parcels.map((p) => ({ ...p, amountCents: p.amountCents + 1 }));
          const b = purchaseInterest(original, more, '2026-11-01');
          expect(a.extraCents).toBe(extra);
          expect(a.monthlyRate!).toBeGreaterThan(0);
          expect(b.monthlyRate!).toBeGreaterThan(a.monthlyRate!);
        },
      ),
    );
  });
});

describe('formatPercent', () => {
  it('formata em pt-BR com 2 casas', () => {
    expect(formatPercent(4.9123)).toBe('4,91%');
    expect(formatPercent(15)).toBe('15,00%');
  });
});
