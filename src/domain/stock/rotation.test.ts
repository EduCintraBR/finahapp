import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StockError } from './quantity';
import { ageText, checkDue, nextCheckDate, planRepack, repackExpiry } from './rotation';

describe('repackExpiry (D84)', () => {
  it('selagem + prazo do produto; sem prazo, o usuário informa', () => {
    expect(repackExpiry('2026-11-05', 12)).toBe('2027-11-05');
    expect(repackExpiry('2026-01-31', 1)).toBe('2026-02-28');
    expect(repackExpiry('2026-11-05', null)).toBeNull();
  });
});

describe('planRepack', () => {
  const lots = [
    { id: 'a', code: 'ARR-01', quantity: 3 },
    { id: 'b', code: 'ARR-02', quantity: 1 },
  ];

  it('tira de cada lote o pedido, ignorando as linhas zeradas', () => {
    expect(
      planRepack(lots, [
        { lotId: 'a', packages: 2 },
        { lotId: 'b', packages: 0 },
      ]),
    ).toEqual([{ lotId: 'a', packages: 2 }]);
  });

  it('recusa lote negativo, lote de fora, lote repetido e envase sem origem', () => {
    expect(() => planRepack(lots, [{ lotId: 'b', packages: 2 }])).toThrow(
      'O lote ARR-02 tem só 1 embalagem.',
    );
    expect(() => planRepack(lots, [{ lotId: 'x', packages: 1 }])).toThrow('não encontrado');
    expect(() =>
      planRepack(lots, [
        { lotId: 'a', packages: 1 },
        { lotId: 'a', packages: 1 },
      ]),
    ).toThrow('aparece duas vezes');
    expect(() => planRepack(lots, [{ lotId: 'a', packages: 0 }])).toThrow(StockError);
    expect(() => planRepack(lots, [])).toThrow('Escolha de qual lote');
  });

  it('propriedade: o que sai de cada lote nunca passa do que ele tem, e a soma é a pedida', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 1, maxLength: 6 }),
        fc.array(fc.integer({ min: 0, max: 12 }), { minLength: 1, maxLength: 6 }),
        (quantities, wanted) => {
          const ls = quantities.map((q, i) => ({ id: `l${i}`, code: `X-${i}`, quantity: q }));
          const sources = wanted.slice(0, ls.length).map((p, i) => ({ lotId: `l${i}`, packages: p }));
          let plan: { lotId: string; packages: number }[];
          try {
            plan = planRepack(ls, sources);
          } catch (err) {
            expect(err).toBeInstanceOf(StockError);
            return;
          }
          for (const p of plan)
            expect(p.packages).toBeLessThanOrEqual(ls.find((l) => l.id === p.lotId)!.quantity);
          expect(plan.reduce((s, p) => s + p.packages, 0)).toBe(sources.reduce((s, p) => s + p.packages, 0));
        },
      ),
    );
  });
});

describe('conferência (D85)', () => {
  it('a próxima vem da última conferência, ou da selagem/entrada', () => {
    expect(nextCheckDate('2026-05-10', null, 3)).toBe('2026-08-10');
    expect(nextCheckDate('2026-05-10', '2026-09-01', 3)).toBe('2026-12-01');
    // conferência registrada antes da entrada (data errada) não puxa a próxima para trás
    expect(nextCheckDate('2026-05-10', '2026-04-01', 3)).toBe('2026-08-10');
    expect(nextCheckDate('2026-05-10', null, null)).toBeNull();
  });

  it('a fazer quando a data chegou', () => {
    expect(checkDue('2026-11-05', '2026-11-05')).toBe(true);
    expect(checkDue('2026-11-04', '2026-11-05')).toBe(true);
    expect(checkDue('2026-11-06', '2026-11-05')).toBe(false);
    expect(checkDue(null, '2026-11-05')).toBe(false);
  });
});

describe('ageText', () => {
  it('dias, meses completos e anos', () => {
    expect(ageText('2026-11-05', '2026-11-05')).toBe('hoje');
    expect(ageText('2026-11-04', '2026-11-05')).toBe('há 1 dia');
    expect(ageText('2026-10-20', '2026-11-05')).toBe('há 16 dias');
    expect(ageText('2026-10-05', '2026-11-05')).toBe('há 1 mês');
    expect(ageText('2026-03-05', '2026-11-05')).toBe('há 8 meses');
    expect(ageText('2026-03-06', '2026-11-05')).toBe('há 7 meses');
    expect(ageText('2025-11-05', '2026-11-05')).toBe('há 1 ano');
    expect(ageText('2024-09-01', '2026-11-05')).toBe('há 2 anos e 2 meses');
  });
});
