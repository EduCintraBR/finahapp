import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addMonths } from '../dates';
import {
  cardChargesDue,
  monthsToMaterialize,
  occurrenceKey,
  planChangeFrom,
  planOccurrences,
  type TemplateWindow,
} from './occurrences';

const tpl = (over: Partial<TemplateWindow> = {}): TemplateWindow => ({
  id: 't1',
  startMonth: '2026-10-01',
  endMonth: null,
  isActive: true,
  dayOfMonth: 10,
  paymentMethod: 'PIX',
  ...over,
});

describe('monthsToMaterialize (D17)', () => {
  it('do início até o mês atual, nunca o futuro', () => {
    expect(monthsToMaterialize(tpl(), '2026-10-01', '2027-01-15')).toEqual([
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
    ]);
  });

  it('não gera antes do saldo inicial: nem meses anteriores, nem vencimento anterior no mesmo mês', () => {
    // dia 10 < início em 20/10: a conta de outubro já estava paga antes do controle começar (D18)
    expect(monthsToMaterialize(tpl({ startMonth: '2026-01-01' }), '2026-10-20', '2026-11-01')).toEqual([
      '2026-11-01',
    ]);
    expect(
      monthsToMaterialize(tpl({ startMonth: '2026-01-01', dayOfMonth: 25 }), '2026-10-20', '2026-11-01'),
    ).toEqual(['2026-10-01', '2026-11-01']);
  });

  it('respeita o mês final e o template inativo', () => {
    expect(monthsToMaterialize(tpl({ endMonth: '2026-11-01' }), '2026-10-01', '2027-02-01')).toEqual([
      '2026-10-01',
      '2026-11-01',
    ]);
    expect(monthsToMaterialize(tpl({ isActive: false }), '2026-10-01', '2027-02-01')).toEqual([]);
  });

  it('template que começa no futuro não gera nada ainda', () => {
    expect(monthsToMaterialize(tpl({ startMonth: '2027-03-01' }), '2026-10-01', '2026-12-31')).toEqual([]);
  });

  it('cartão de crédito fica para a Fase 3', () => {
    expect(monthsToMaterialize(tpl({ paymentMethod: 'CREDIT_CARD' }), '2026-10-01', '2026-12-31')).toEqual(
      [],
    );
  });
});

describe('planOccurrences', () => {
  it('due_date com dia inexistente vira o último dia do mês', () => {
    const plans = planOccurrences(
      [tpl({ dayOfMonth: 31, startMonth: '2027-02-01' })],
      new Set(),
      '2026-10-01',
      '2027-02-10',
    );
    expect(plans).toEqual([{ templateId: 't1', occurrenceMonth: '2027-02-01', dueDate: '2027-02-28' }]);
  });

  it('pula o que já existe', () => {
    const plans = planOccurrences(
      [tpl()],
      new Set([occurrenceKey('t1', '2026-10-01')]),
      '2026-10-01',
      '2026-11-05',
    );
    expect(plans.map((p) => p.occurrenceMonth)).toEqual(['2026-11-01']);
  });

  it('property: idempotente — aplicar o plano e planejar de novo não gera nada', () => {
    const arb = fc.record({
      startOffset: fc.integer({ min: -24, max: 12 }),
      len: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
      day: fc.integer({ min: 1, max: 31 }),
      todayOffset: fc.integer({ min: 0, max: 36 }),
    });
    fc.assert(
      fc.property(fc.array(arb, { maxLength: 5 }), fc.integer({ min: 0, max: 36 }), (specs, todayOffset) => {
        const opening = '2026-10-01';
        const templates = specs.map((s, i) => {
          const start = addMonths(opening, s.startOffset);
          return tpl({
            id: `t${i}`,
            startMonth: start,
            endMonth: s.len === null ? null : addMonths(start, s.len),
            dayOfMonth: s.day,
          });
        });
        const today = addMonths('2026-10-15', todayOffset);
        const first = planOccurrences(templates, new Set(), opening, today);
        const keys = new Set(first.map((p) => occurrenceKey(p.templateId, p.occurrenceMonth)));
        expect(keys.size).toBe(first.length); // sem duplicatas
        expect(planOccurrences(templates, keys, opening, today)).toEqual([]);
        for (const p of first) {
          expect(p.occurrenceMonth >= '2026-10-01').toBe(true);
          expect(p.occurrenceMonth <= today).toBe(true);
          expect(p.dueDate.slice(0, 7)).toBe(p.occurrenceMonth.slice(0, 7));
        }
      }),
    );
  });
});

describe('cardChargesDue (D33)', () => {
  const card = (over: Partial<TemplateWindow> = {}) =>
    tpl({ paymentMethod: 'CREDIT_CARD', dayOfMonth: 15, ...over });
  it('só cobranças cujo dia já chegou, desde o início do controle', () => {
    expect(cardChargesDue(card(), '2026-10-01', '2026-12-14')).toEqual([
      { month: '2026-10-01', chargeDate: '2026-10-15' },
      { month: '2026-11-01', chargeDate: '2026-11-15' },
    ]);
    expect(cardChargesDue(card(), '2026-10-01', '2026-12-15').map((c) => c.chargeDate)).toContain(
      '2026-12-15',
    );
  });
  it('dia 31 vira o fim do mês; antes do início do controle não cobra', () => {
    expect(cardChargesDue(card({ dayOfMonth: 31 }), '2026-10-20', '2026-11-30')).toEqual([
      { month: '2026-10-01', chargeDate: '2026-10-31' },
      { month: '2026-11-01', chargeDate: '2026-11-30' },
    ]);
    expect(cardChargesDue(card(), '2026-10-20', '2026-10-31')).toEqual([]);
  });
  it('template de conta não gera cobrança no cartão', () => {
    expect(cardChargesDue(tpl(), '2026-10-01', '2026-12-31')).toEqual([]);
  });
});

describe('planChangeFrom (D21)', () => {
  const t = { startMonth: '2026-10-01', endMonth: null };
  it('a partir de um mês posterior: encerra no anterior e cria novo', () =>
    expect(planChangeFrom(t, '2027-01-01')).toEqual({
      mode: 'SPLIT',
      oldEndMonth: '2026-12-01',
      newStartMonth: '2027-01-01',
    }));
  it('a partir do próprio início: edita no lugar', () =>
    expect(planChangeFrom(t, '2026-10-01')).toEqual({ mode: 'IN_PLACE' }));
  it('erros', () => {
    expect(planChangeFrom(t, '2026-09-01')).toHaveProperty('error');
    expect(planChangeFrom(t, '2026-11-15')).toHaveProperty('error');
    expect(planChangeFrom({ ...t, endMonth: '2026-12-01' }, '2027-01-01')).toHaveProperty('error');
  });
});
