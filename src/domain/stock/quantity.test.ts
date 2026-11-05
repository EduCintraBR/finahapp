import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  adjustmentDelta,
  allocateFefo,
  expiryLevel,
  lotQuantity,
  quantityAfter,
  signedQuantity,
  sortFefo,
  StockError,
  totalInMeasure,
  type FefoLot,
  type MovementKind,
} from './quantity';

const lot = (id: string, quantity: number, expiryDate: string | null, entryDate = '2026-11-01', number = 1) =>
  ({ id, number, quantity, entryDate, expiryDate }) satisfies FefoLot;

describe('signedQuantity', () => {
  it('a direção vem do tipo; ADJUST já vem assinado', () => {
    expect(signedQuantity('IN', 3)).toBe(3);
    expect(signedQuantity('REPACK_IN', 11)).toBe(11);
    expect(signedQuantity('USE', 2)).toBe(-2);
    expect(signedQuantity('DISCARD', 1)).toBe(-1);
    expect(signedQuantity('REPACK_OUT', 2)).toBe(-2);
    expect(signedQuantity('ADJUST', -4)).toBe(-4);
  });

  it('recusa zero, fração e negativo fora do ajuste', () => {
    expect(() => signedQuantity('IN', 0)).toThrow(StockError);
    expect(() => signedQuantity('USE', 1.5)).toThrow(StockError);
    expect(() => signedQuantity('USE', -1)).toThrow('maior que zero');
    expect(() => signedQuantity('ADJUST', 0)).toThrow(StockError);
  });
});

describe('quantidade do lote', () => {
  it('soma só os movimentos não cancelados', () => {
    expect(
      lotQuantity([
        { quantity: 5, cancelled: false },
        { quantity: -2, cancelled: false },
        { quantity: -3, cancelled: true },
      ]),
    ).toBe(3);
  });

  it('recusa a saída que deixaria o lote negativo', () => {
    expect(quantityAfter(3, -3, 'ARR-01')).toBe(0);
    expect(() => quantityAfter(2, -3, 'ARR-01')).toThrow('O lote ARR-01 tem só 2 embalagens.');
    expect(() => quantityAfter(1, -2, 'ARR-01')).toThrow('tem só 1 embalagem.');
    expect(() => quantityAfter(0, -1, 'ARR-01')).toThrow('já está zerado');
  });

  it('propriedade: aplicar só o que quantityAfter aceita nunca deixa o lote negativo, e a soma é a quantidade', () => {
    const kinds: MovementKind[] = ['IN', 'USE', 'DISCARD', 'ADJUST', 'REPACK_OUT', 'REPACK_IN'];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            kind: fc.constantFrom(...kinds),
            packages: fc.integer({ min: 1, max: 50 }),
            neg: fc.boolean(),
          }),
          { maxLength: 60 },
        ),
        (ops) => {
          const accepted: { quantity: number; cancelled: boolean }[] = [];
          let current = 0;
          for (const op of ops) {
            const delta = signedQuantity(
              op.kind,
              op.kind === 'ADJUST' && op.neg ? -op.packages : op.packages,
            );
            try {
              current = quantityAfter(current, delta, 'X-01');
              accepted.push({ quantity: delta, cancelled: false });
            } catch (err) {
              expect(err).toBeInstanceOf(StockError);
            }
            expect(current).toBeGreaterThanOrEqual(0);
          }
          expect(lotQuantity(accepted)).toBe(current);
        },
      ),
    );
  });
});

describe('adjustmentDelta ("Contei")', () => {
  it('é a diferença entre o contado e o do app', () => {
    expect(adjustmentDelta(5, 3)).toBe(-2);
    expect(adjustmentDelta(0, 4)).toBe(4);
    expect(adjustmentDelta(4, 0)).toBe(-4);
  });

  it('recusa contagem igual, negativa ou fracionada', () => {
    expect(() => adjustmentDelta(3, 3)).toThrow('nada para ajustar');
    expect(() => adjustmentDelta(3, -1)).toThrow(StockError);
    expect(() => adjustmentDelta(3, 1.5)).toThrow(StockError);
  });
});

describe('FEFO', () => {
  it('validade mais próxima primeiro, sem validade por último, depois a entrada mais antiga e o número', () => {
    const lots = [
      lot('sem', 1, null, '2026-01-01'),
      lot('dez', 1, '2026-12-10'),
      lot('nov-novo', 1, '2026-11-20', '2026-11-03', 3),
      lot('nov-velho', 1, '2026-11-20', '2026-10-01', 2),
      lot('nov-velho-2', 1, '2026-11-20', '2026-10-01', 4),
    ];
    expect(sortFefo(lots).map((l) => l.id)).toEqual(['nov-velho', 'nov-velho-2', 'nov-novo', 'dez', 'sem']);
    expect(lots[0]!.id).toBe('sem'); // não muda o array recebido
  });

  it('esgota o lote que vence primeiro antes de passar ao seguinte', () => {
    const lots = [lot('b', 5, '2027-03-01'), lot('a', 2, '2026-12-01'), lot('zerado', 0, '2026-11-10')];
    expect(allocateFefo(lots, 3)).toEqual([
      { lotId: 'a', packages: 2 },
      { lotId: 'b', packages: 1 },
    ]);
    expect(allocateFefo(lots, 1)).toEqual([{ lotId: 'a', packages: 1 }]);
  });

  it('recusa quando o estoque não tem tudo', () => {
    expect(() => allocateFefo([lot('a', 2, null)], 3)).toThrow('Só tem 2 embalagens no estoque.');
    expect(() => allocateFefo([lot('a', 0, null)], 1)).toThrow('sem estoque');
    expect(() => allocateFefo([lot('a', 2, null)], 0)).toThrow(StockError);
  });

  it('propriedade: tira exatamente o pedido, nunca mais que um lote tem, e só abre um lote depois de esgotar os anteriores', () => {
    const lotArb = fc.record({
      quantity: fc.integer({ min: 0, max: 20 }),
      expiry: fc.option(fc.integer({ min: 0, max: 400 }), { nil: null }),
      entry: fc.integer({ min: 0, max: 400 }),
    });
    fc.assert(
      fc.property(
        fc.array(lotArb, { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 300 }),
        (raw, want) => {
          const day = (n: number) =>
            `2026-${String(1 + (Math.floor(n / 28) % 12)).padStart(2, '0')}-${String(1 + (n % 28)).padStart(2, '0')}`;
          const lots = raw.map((r, i) =>
            lot(`l${i}`, r.quantity, r.expiry === null ? null : day(r.expiry), day(r.entry), i + 1),
          );
          const available = lots.reduce((s, l) => s + l.quantity, 0);
          if (want > available) {
            expect(() => allocateFefo(lots, want)).toThrow(StockError);
            return;
          }
          const out = allocateFefo(lots, want);
          expect(out.reduce((s, o) => s + o.packages, 0)).toBe(want);
          const byId = new Map(lots.map((l) => [l.id, l]));
          for (const o of out) {
            expect(o.packages).toBeGreaterThan(0);
            expect(o.packages).toBeLessThanOrEqual(byId.get(o.lotId)!.quantity);
          }
          // na ordem FEFO, todos os lotes antes do último usado foram esgotados
          const order = sortFefo(lots).filter((l) => l.quantity > 0);
          const used = new Map(out.map((o) => [o.lotId, o.packages]));
          const lastIdx = Math.max(...out.map((o) => order.findIndex((l) => l.id === o.lotId)));
          order.slice(0, lastIdx).forEach((l) => expect(used.get(l.id)).toBe(l.quantity));
        },
      ),
    );
  });
});

describe('totalInMeasure', () => {
  it('embalagens × conteúdo; sem conteúdo conta 1 por embalagem; lote zerado não entra', () => {
    expect(
      totalInMeasure([
        { quantity: 2, contentPerPackage: 5000 },
        { quantity: 11, contentPerPackage: 1800 },
        { quantity: 0, contentPerPackage: 1000 },
      ]),
    ).toBe(29_800);
    expect(totalInMeasure([{ quantity: 3, contentPerPackage: null }])).toBe(3);
  });
});

describe('expiryLevel', () => {
  it('vencido antes de hoje, vencendo até 30 dias, depois ok', () => {
    const hoje = '2026-11-05';
    expect(expiryLevel(null, hoje)).toBeNull();
    expect(expiryLevel('2026-11-04', hoje)).toBe('expired');
    expect(expiryLevel('2026-11-05', hoje)).toBe('soon');
    expect(expiryLevel('2026-12-05', hoje)).toBe('soon');
    expect(expiryLevel('2026-12-06', hoje)).toBe('ok');
  });
});
