import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, addMonths, compareDates } from '../dates';
import {
  availableLimit,
  invoiceSequence,
  invoiceState,
  remainingToPay,
  resolveInvoice,
  ruleInvoice,
  suggestClosingDay,
  type InvoiceWindow,
} from './invoices';

const nubank = { closingDay: 3, dueDay: 10 };

describe('ruleInvoice (D29)', () => {
  it('fechamento no mesmo mês quando closingDay < dueDay', () => {
    expect(ruleInvoice('2026-11-01', nubank)).toEqual({
      referenceMonth: '2026-11-01',
      closingDate: '2026-11-03',
      dueDate: '2026-11-10',
    });
  });

  it('fechamento no mês anterior quando closingDay ≥ dueDay', () => {
    expect(ruleInvoice('2026-11-01', { closingDay: 28, dueDay: 5 })).toEqual({
      referenceMonth: '2026-11-01',
      closingDate: '2026-10-28',
      dueDate: '2026-11-05',
    });
  });

  it('dia inexistente vira o último dia do mês', () => {
    expect(ruleInvoice('2027-02-01', { closingDay: 31, dueDay: 7 })).toMatchObject({
      closingDate: '2027-01-31',
      dueDate: '2027-02-07',
    });
    expect(ruleInvoice('2027-03-01', { closingDay: 30, dueDay: 7 })).toMatchObject({
      closingDate: '2027-02-28',
    });
  });

  it('fechamento nunca cola no vencimento', () => {
    // fevereiro: 30 e 31 viram 28
    expect(ruleInvoice('2027-02-01', { closingDay: 30, dueDay: 31 })).toMatchObject({
      closingDate: '2027-02-27',
      dueDate: '2027-02-28',
    });
  });

  it('property: vencimento no mês de referência e sempre depois do fechamento', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 120 }),
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 1, max: 31 }),
        (offset, closingDay, dueDay) => {
          const ref = addMonths('2026-01-01', offset);
          const w = ruleInvoice(ref, { closingDay, dueDay });
          expect(w.dueDate.slice(0, 7)).toBe(ref.slice(0, 7));
          expect(compareDates(w.closingDate, w.dueDate)).toBe(-1);
        },
      ),
    );
  });

  it('sugestão de fechamento = vencimento − 7', () => {
    expect(suggestClosingDay(10)).toBe(3);
    expect(suggestClosingDay(8)).toBe(1);
    expect(suggestClosingDay(7)).toBe(31);
    expect(suggestClosingDay(5)).toBe(29);
  });
});

describe('resolveInvoice (invariante 5)', () => {
  it('antes do fechamento → esta fatura; no dia ou depois → a próxima', () => {
    expect(resolveInvoice('2026-11-02', [], nubank).referenceMonth).toBe('2026-11-01');
    expect(resolveInvoice('2026-11-03', [], nubank).referenceMonth).toBe('2026-12-01');
    expect(resolveInvoice('2026-11-20', [], nubank).referenceMonth).toBe('2026-12-01');
    expect(resolveInvoice('2026-10-16', [], nubank).referenceMonth).toBe('2026-11-01');
  });

  it('usa a data real materializada (o banco moveu o fechamento)', () => {
    const moved: InvoiceWindow[] = [
      { referenceMonth: '2026-11-01', closingDate: '2026-11-05', dueDate: '2026-11-12' },
    ];
    expect(resolveInvoice('2026-11-04', moved, nubank).referenceMonth).toBe('2026-11-01');
    expect(resolveInvoice('2026-11-04', [], nubank).referenceMonth).toBe('2026-12-01');
  });

  it('fechamento no mês anterior ao vencimento', () => {
    const rule = { closingDay: 28, dueDay: 5 };
    expect(resolveInvoice('2026-10-27', [], rule).referenceMonth).toBe('2026-11-01');
    expect(resolveInvoice('2026-10-28', [], rule).referenceMonth).toBe('2026-12-01');
  });

  it('property: a fatura escolhida é a de menor fechamento > data da compra', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 800 }),
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 1, max: 31 }),
        (offset, closingDay, dueDay) => {
          const rule = { closingDay, dueDay };
          const date = addDays('2026-01-01', offset);
          const w = resolveInvoice(date, [], rule);
          expect(compareDates(w.closingDate, date)).toBe(1);
          // a fatura anterior fecha no dia da compra ou antes
          const prev = ruleInvoice(addMonths(w.referenceMonth, -1), rule);
          expect(compareDates(prev.closingDate, date)).toBeLessThanOrEqual(0);
        },
      ),
    );
  });

  it('parcelas em faturas consecutivas', () => {
    expect(invoiceSequence('2026-11-01', 3, [], nubank).map((w) => w.referenceMonth)).toEqual([
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
    ]);
  });
});

describe('invoiceState (D30)', () => {
  const base = { closingDate: '2026-11-03', dueDate: '2026-11-10', totalCents: 10_000, paidCents: 0 };
  it.each([
    ['2026-11-02', 0, 'OPEN'],
    ['2026-11-03', 0, 'CLOSED'],
    ['2026-11-10', 0, 'CLOSED'],
    ['2026-11-11', 0, 'OVERDUE'],
    ['2026-11-11', 5_000, 'OVERDUE'], // parcial não quita (D25)
    ['2026-11-05', 10_000, 'PAID'],
    ['2026-11-01', 10_000, 'OPEN'], // pago antes de fechar continua aberta
  ])('hoje %s, pago %i → %s', (today, paidCents, expected) => {
    expect(invoiceState({ ...base, paidCents, today })).toBe(expected);
  });

  it('fatura credora ou zerada não tem nada a pagar depois de fechar', () => {
    expect(invoiceState({ ...base, totalCents: -3_334, today: '2026-11-20' })).toBe('PAID');
  });

  it('restante a pagar', () => {
    expect(remainingToPay(10_000, 4_000)).toBe(6_000);
    expect(remainingToPay(10_000, 12_000)).toBe(0);
    expect(remainingToPay(-500, 0)).toBe(0);
  });
});

describe('availableLimit', () => {
  it('fórmula canônica, inclusive saldo credor', () => {
    expect(availableLimit(500_000, 10_000, 0)).toBe(490_000);
    expect(availableLimit(500_000, 10_000 - 6_666 - 3_334 - 3_334, 3_334)).toBe(506_668);
  });
  it('adicional sem limite rastreado', () => expect(availableLimit(null, 5_000, 0)).toBeNull());
});
