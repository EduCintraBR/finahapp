import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, compareDates, diffDays } from '../dates';
import { purchaseDueDates } from '../card/store-credit';
import {
  breakdown,
  buildDays,
  firstNegativeFrom,
  firstNegativePoint,
  flowDate,
  groupByMonth,
  isOverdue,
  lowestFrom,
  lowestPoint,
  pointsRoom,
  purchaseCharges,
  shiftBalances,
  simulate,
  spendingRoom,
  toPoints,
  type CashFlow,
  type FlowSource,
} from './cash-forecast';

let n = 0;
const flow = (date: string, amountCents: number, over: Partial<CashFlow> = {}): CashFlow => ({
  key: `f${n++}`,
  date,
  originalDate: date,
  amountCents,
  source: 'PENDING',
  overdue: false,
  label: `item ${n}`,
  detail: null,
  href: null,
  ...over,
});

describe('flowDate / isOverdue (D94: atrasado cai hoje)', () => {
  it('venceu antes de hoje → hoje; hoje ou depois → o vencimento', () => {
    expect(flowDate('2026-11-10', '2026-11-25')).toBe('2026-11-25');
    expect(isOverdue('2026-11-10', '2026-11-25')).toBe(true);
    expect(flowDate('2026-11-25', '2026-11-25')).toBe('2026-11-25');
    expect(isOverdue('2026-11-25', '2026-11-25')).toBe(false);
    expect(flowDate('2026-12-05', '2026-11-25')).toBe('2026-12-05');
  });
});

describe('buildDays', () => {
  it('um dia por data, saldo encadeado e movimentos ordenados (pago, entradas, saídas maiores)', () => {
    const days = buildDays('2026-11-24', '2026-11-27', 100_00, [
      flow('2026-11-25', -30_00, { label: 'luz' }),
      flow('2026-11-25', 50_00, { label: 'pix' }),
      flow('2026-11-25', -80_00, { label: 'aluguel' }),
      flow('2026-11-25', -10_00, { label: 'café', source: 'REALIZED' }),
      flow('2026-11-27', -500_00, { label: 'fatura', source: 'INVOICE' }),
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
    expect(days[0]).toMatchObject({ openingCents: 100_00, closingCents: 100_00, inCents: 0, outCents: 0 });
    expect(days[1]).toMatchObject({
      openingCents: 100_00,
      inCents: 50_00,
      outCents: 120_00,
      closingCents: 30_00,
    });
    expect(days[1]!.flows.map((f) => f.label)).toEqual(['café', 'pix', 'aluguel', 'luz']);
    expect(days[2]!.closingCents).toBe(30_00);
    expect(days[3]!.closingCents).toBe(-470_00);
  });

  it('recusa movimento fora do intervalo e valor que não é centavo inteiro', () => {
    expect(() => buildDays('2026-11-01', '2026-11-30', 0, [flow('2026-12-01', 1)])).toThrow(
      /fora do intervalo/,
    );
    expect(() => buildDays('2026-11-01', '2026-11-30', 0, [flow('2026-11-02', 1.5)])).toThrow();
    expect(() => buildDays('2026-11-30', '2026-11-01', 0, [])).toThrow(/inválido/);
  });

  const flowsArb = fc.array(
    fc.record({
      offset: fc.integer({ min: 0, max: 89 }),
      amount: fc.integer({ min: -5_000_000, max: 5_000_000 }),
    }),
    { maxLength: 60 },
  );

  it('property: fechamento de cada dia = abertura + Σ movimentos; último = partida + Σ todos', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000_000, max: 10_000_000 }), flowsArb, (opening, raw) => {
        const from = '2026-11-01';
        const flows = raw.map((r) => flow(addDays(from, r.offset), r.amount));
        const days = buildDays(from, addDays(from, 89), opening, flows);
        expect(days).toHaveLength(90);
        let prev = opening;
        for (const d of days) {
          expect(d.openingCents).toBe(prev);
          expect(d.closingCents).toBe(d.openingCents + d.flows.reduce((s, f) => s + f.amountCents, 0));
          expect(d.inCents - d.outCents).toBe(d.closingCents - d.openingCents);
          prev = d.closingCents;
        }
        expect(days.at(-1)!.closingCents).toBe(opening + raw.reduce((s, r) => s + r.amount, 0));
        expect(days.flatMap((d) => d.flows)).toHaveLength(flows.length); // nenhum movimento some
      }),
    );
  });

  it('property: os meses encadeiam (abertura do mês = fechamento do anterior) e somam os dias', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000, max: 1_000_000 }), flowsArb, (opening, raw) => {
        const from = '2026-11-01';
        const days = buildDays(
          from,
          addDays(from, 89),
          opening,
          raw.map((r) => flow(addDays(from, r.offset), r.amount)),
        );
        const months = groupByMonth(days);
        expect(months.map((m) => m.month)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
        expect(months[0]!.openingCents).toBe(opening);
        for (let i = 1; i < months.length; i++) {
          expect(months[i]!.openingCents).toBe(months[i - 1]!.closingCents);
        }
        for (const m of months) {
          expect(m.closingCents).toBe(m.openingCents + m.inCents - m.outCents);
          expect(m.days.every((d) => d.date.slice(0, 7) === m.month.slice(0, 7))).toBe(true);
        }
      }),
    );
  });
});

describe('lowestFrom / firstNegativeFrom / spendingRoom', () => {
  const days = buildDays('2026-11-25', '2026-12-31', 1_000_00, [
    flow('2026-11-28', -1_200_00), // −200
    flow('2026-12-05', 3_000_00), // 2.800
    flow('2026-12-10', -2_500_00), // 300
    flow('2026-12-20', -100_00), // 200
  ]);

  it('menor saldo e primeiro dia negativo a partir de uma data', () => {
    expect(lowestFrom(days, '2026-11-25')).toEqual({ date: '2026-11-28', cents: -200_00 });
    expect(firstNegativeFrom(days, '2026-11-25')?.date).toBe('2026-11-28');
    expect(lowestFrom(days, '2026-12-05')).toEqual({ date: '2026-12-20', cents: 200_00 });
    expect(firstNegativeFrom(days, '2026-12-05')).toBeNull();
    expect(lowestFrom(days, '2027-01-01')).toBeNull();
  });

  it('folga para um gasto que só sai em uma data: o menor saldo dali em diante (0 se negativo)', () => {
    expect(spendingRoom(days, '2026-12-10')).toBe(200_00);
    expect(spendingRoom(days, '2026-11-26')).toBe(0);
    expect(spendingRoom(days, '2027-02-01')).toBeNull();
  });

  it('property: gastar exatamente a folga nunca deixa dia negativo dali em diante; 1 centavo a mais deixa', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -500_000, max: 2_000_000 }),
        fc.array(
          fc.record({
            offset: fc.integer({ min: 0, max: 59 }),
            amount: fc.integer({ min: -900_000, max: 900_000 }),
          }),
          { maxLength: 30 },
        ),
        fc.integer({ min: 0, max: 59 }),
        (opening, raw, dueOffset) => {
          const from = '2026-11-01';
          const base = buildDays(
            from,
            addDays(from, 59),
            opening,
            raw.map((r) => flow(addDays(from, r.offset), r.amount)),
          );
          const due = addDays(from, dueOffset);
          const room = spendingRoom(base, due)!;
          const neg = (cents: number) =>
            firstNegativeFrom(simulate(base, [{ date: due, amountCents: cents, label: 'x' }]).days, due);
          if (room > 0) expect(neg(room)).toBeNull();
          const minAfter = lowestFrom(base, due)!.cents;
          if (minAfter >= 0) expect(neg(room + 1)).not.toBeNull();
        },
      ),
    );
  });
});

describe('purchaseCharges / simulate', () => {
  it('parcelas somam o total, resto na 1ª, cada uma no vencimento da sua fatura', () => {
    const c = purchaseCharges(1_000_00 + 1, ['2026-12-16', '2027-01-16', '2027-02-16'], 'TV');
    expect(c).toEqual([
      { date: '2026-12-16', amountCents: 33_335, label: 'TV (1/3)' },
      { date: '2027-01-16', amountCents: 33_333, label: 'TV (2/3)' },
      { date: '2027-02-16', amountCents: 33_333, label: 'TV (3/3)' },
    ]);
    expect(purchaseCharges(500, ['2026-12-16'], 'X')[0]!.label).toBe('X');
    expect(() => purchaseCharges(0, ['2026-12-16'], 'X')).toThrow(/maior que zero/);
  });

  it('property: Σ parcelas = total', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000 }), fc.integer({ min: 1, max: 24 }), (extra, k) => {
        const total = k + extra; // pelo menos R$ 0,01 por parcela
        const dates = Array.from({ length: k }, (_, i) => addDays('2026-12-01', 30 * i));
        expect(purchaseCharges(total, dates, 'x').reduce((s, c) => s + c.amountCents, 0)).toBe(total);
      }),
    );
  });

  it('simula sem mexer nos dias originais; o que passa do horizonte fica de fora', () => {
    const base = buildDays('2026-11-25', '2026-12-31', 500_00, [flow('2026-12-05', -100_00)]);
    const { days, outside } = simulate(
      base,
      purchaseCharges(600_00, ['2026-12-16', '2027-01-16'], 'Geladeira'),
    );
    expect(base.at(-1)!.closingCents).toBe(400_00);
    expect(days.at(-1)!.closingCents).toBe(100_00);
    expect(days.find((d) => d.date === '2026-12-16')!.flows[0]).toMatchObject({
      source: 'SIMULATION',
      amountCents: -300_00,
      label: 'Geladeira (1/2)',
    });
    expect(outside).toEqual([{ date: '2027-01-16', amountCents: 300_00, label: 'Geladeira (2/2)' }]);
  });
});

describe('shiftBalances (série leve do navegador)', () => {
  it('property: dá os mesmos saldos que simulate; folga e 1º negativo batem com os dias', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -500_000, max: 2_000_000 }),
        fc.array(
          fc.record({
            offset: fc.integer({ min: 0, max: 59 }),
            amount: fc.integer({ min: -900_000, max: 900_000 }),
          }),
          { maxLength: 30 },
        ),
        fc.array(
          fc.record({
            offset: fc.integer({ min: 0, max: 59 }),
            amount: fc.integer({ min: 1, max: 900_000 }),
          }),
          { maxLength: 6 },
        ),
        fc.integer({ min: 0, max: 59 }),
        (opening, raw, rawCharges, cut) => {
          const from = '2026-11-01';
          const days = buildDays(
            from,
            addDays(from, 59),
            opening,
            raw.map((r) => flow(addDays(from, r.offset), r.amount)),
          );
          const charges = rawCharges.map((c) => ({
            date: addDays(from, c.offset),
            amountCents: c.amount,
            label: 's',
          }));
          const sim = simulate(days, charges).days;
          const shifted = shiftBalances(toPoints(days), charges);
          expect(shifted).toEqual(toPoints(sim));
          const cutDate = addDays(from, cut);
          expect(pointsRoom(shifted, cutDate)).toBe(spendingRoom(sim, cutDate));
          expect(lowestPoint(shifted, cutDate)?.closingCents).toBe(lowestFrom(sim, cutDate)?.cents);
          expect(firstNegativePoint(shifted, cutDate)?.date).toBe(firstNegativeFrom(sim, cutDate)?.date);
        },
      ),
    );
  });
});

describe('breakdown', () => {
  it('separa cada parte; atrasado é parte própria; Σ partes = fechamento − abertura', () => {
    const today = '2026-11-25';
    const flows = [
      flow('2026-11-03', 5_000_00, { source: 'REALIZED' }),
      flow('2026-11-10', -1_000_00, { source: 'REALIZED' }),
      flow(today, -200_00, { overdue: true, originalDate: '2026-11-10' }),
      flow(today, 300_00, { overdue: true, originalDate: '2026-11-15' }),
      flow('2026-11-28', -150_00),
      flow('2026-11-29', 99_00, { source: 'SCHEDULED' }),
      flow('2026-11-30', -1_234_00, { source: 'INVOICE' }),
      flow('2026-12-10', -500_00, { source: 'LOAN' }),
      flow('2026-12-10', 7_000_00, { source: 'FIXED' }),
      flow('2026-12-10', -2_000_00, { source: 'FIXED' }),
      flow('2026-12-15', -300_00, { source: 'VARIABLE' }),
      flow('2026-12-16', -55_90, { source: 'SUBSCRIPTION' }),
    ];
    const days = buildDays('2026-11-01', '2026-12-31', 1_000_00, flows);
    const b = breakdown(days);
    expect(b).toEqual({
      realizedIn: 5_000_00,
      realizedOut: -1_000_00,
      overdueOut: -200_00,
      overdueIn: 300_00,
      pendingOut: -150_00,
      scheduledIn: 99_00,
      invoices: -1_234_00,
      loans: -500_00,
      fixedIn: 7_000_00,
      fixedOut: -2_000_00,
      variableOut: -300_00,
      subscriptions: -55_90,
    });
    const sum = Object.values(b).reduce((s, v) => s + v, 0);
    expect(sum).toBe(days.at(-1)!.closingCents - 1_000_00);
    // só de hoje em diante: sem o que já aconteceu
    expect(breakdown(days, today).realizedIn).toBeUndefined();
  });

  it('property: Σ partes = variação do saldo no trecho, qualquer que seja a origem', () => {
    const sources: FlowSource[] = [
      'REALIZED',
      'PENDING',
      'SCHEDULED',
      'INVOICE',
      'LOAN',
      'FIXED',
      'VARIABLE',
      'SUBSCRIPTION',
    ];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            offset: fc.integer({ min: 0, max: 40 }),
            amount: fc.integer({ min: -1_000_000, max: 1_000_000 }),
            source: fc.constantFrom(...sources),
            overdue: fc.boolean(),
          }),
          { maxLength: 40 },
        ),
        fc.integer({ min: 0, max: 40 }),
        (raw, cut) => {
          const from = '2026-11-01';
          const days = buildDays(
            from,
            addDays(from, 40),
            0,
            raw.map((r) => flow(addDays(from, r.offset), r.amount, { source: r.source, overdue: r.overdue })),
          );
          const cutDate = addDays(from, cut);
          const sum = Object.values(breakdown(days, cutDate)).reduce((s, v) => s + v, 0);
          const startDay = days.find((d) => compareDates(d.date, cutDate) === 0)!;
          expect(sum).toBe(days.at(-1)!.closingCents - startDay.openingCents);
        },
      ),
    );
  });
});

describe('purchaseDueDates (simulação usa a mesma alocação da compra)', () => {
  const card = {
    kind: 'CARD' as const,
    closingDay: 9,
    dueDay: 16,
    closeBeforeDays: null,
    firstDueDays: null,
  };

  it('cartão: antes do fechamento cai na fatura do mês; depois, na seguinte; parcelas mês a mês', () => {
    expect(purchaseDueDates(card, '2026-11-05', [], 1)).toEqual(['2026-11-16']);
    expect(purchaseDueDates(card, '2026-11-25', [], 3)).toEqual(['2026-12-16', '2027-01-16', '2027-02-16']);
  });

  it('cartão: respeita a data real (editada) da fatura materializada', () => {
    const edited = [
      {
        referenceMonth: '2026-12-01',
        closingDate: '2026-11-27',
        dueDate: '2026-12-04',
        totalCents: 0,
        paidCents: 0,
      },
    ];
    expect(purchaseDueDates(card, '2026-11-25', edited, 2)).toEqual(['2026-12-04', '2027-01-16']);
  });

  it('crediário sem ciclo ativo: 1ª fatura vence firstDueDays depois, as seguintes no mesmo dia', () => {
    const store = {
      kind: 'STORE_CREDIT' as const,
      closingDay: null,
      dueDay: 5,
      closeBeforeDays: 7,
      firstDueDays: 40,
    };
    const d = purchaseDueDates(store, '2026-11-25', [], 2);
    expect(diffDays(d[0]!, '2026-11-25')).toBe(40);
    expect(d).toEqual(['2027-01-04', '2027-02-04']);
  });
});
