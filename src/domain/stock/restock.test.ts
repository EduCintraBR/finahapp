import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_PACKAGES } from './quantity';
import { isLow, restockNeed } from './restock';

describe('isLow (Acabando)', () => {
  it('só abaixo do mínimo; no mínimo ainda não é; sem mínimo nunca', () => {
    expect(isLow(9_999, 10_000)).toBe(true);
    expect(isLow(10_000, 10_000)).toBe(false);
    expect(isLow(0, 1)).toBe(true);
    expect(isLow(0, null)).toBe(false);
  });
});

describe('restockNeed (lista de compras)', () => {
  const base = { total: 0, min: null, target: null, measure: 'WEIGHT', defaultContent: null } as const;

  it('falta = meta − quanto tem; já na meta (ou acima) não entra na lista', () => {
    expect(restockNeed({ ...base, total: 10_000, min: 10_000, target: 30_000 })).toMatchObject({
      reference: 30_000,
      missing: 20_000,
      belowMin: false,
    });
    expect(restockNeed({ ...base, total: 30_000, target: 30_000 })).toBeNull();
    expect(restockNeed({ ...base, total: 31_000, target: 30_000 })).toBeNull();
  });

  it('sem meta, repõe até o mínimo; sem nenhum dos dois, nunca entra', () => {
    expect(restockNeed({ ...base, total: 4_000, min: 10_000 })).toMatchObject({
      reference: 10_000,
      missing: 6_000,
      belowMin: true,
    });
    expect(restockNeed({ ...base, total: 10_000, min: 10_000 })).toBeNull();
    expect(restockNeed({ ...base, total: 0 })).toBeNull();
  });

  it('sugere embalagens inteiras pelo conteúdo de costume, arredondando para cima', () => {
    expect(restockNeed({ ...base, total: 0, target: 30_000, defaultContent: 5_000 })?.packages).toBe(6);
    expect(restockNeed({ ...base, total: 1, target: 30_000, defaultContent: 5_000 })?.packages).toBe(6);
    expect(
      restockNeed({ ...base, total: 0, target: 40_000, measure: 'VOLUME', defaultContent: 5_000 }),
    ).toMatchObject({ missing: 40_000, packages: 8 });
  });

  it('peso ou volume sem conteúdo de costume: não chuta embalagens', () => {
    expect(restockNeed({ ...base, total: 0, target: 30_000 })?.packages).toBeNull();
  });

  it('por unidade, sem conteúdo = 1 unidade por embalagem; com conteúdo, caixas', () => {
    const unit = { ...base, measure: 'UNIT' } as const;
    expect(restockNeed({ ...unit, total: 2, target: 6 })).toMatchObject({ missing: 4, packages: 4 });
    expect(restockNeed({ ...unit, total: 2, target: 25, defaultContent: 10 })).toMatchObject({
      missing: 23,
      packages: 3,
    });
  });

  it('nunca sugere mais que o limite de embalagens', () => {
    const n = restockNeed({ ...base, measure: 'UNIT', total: 0, target: 1_000_000_000 });
    expect(n?.packages).toBe(MAX_PACKAGES);
  });

  it('property: as embalagens sugeridas cobrem a falta e nenhuma embalagem a mais é necessária', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000 }),
        fc.integer({ min: 1, max: 50_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        (total, extra, content) => {
          const target = total + extra;
          const need = restockNeed({ total, min: null, target, measure: 'WEIGHT', defaultContent: content });
          expect(need).not.toBeNull();
          expect(need!.missing).toBe(extra);
          const packages = need!.packages!;
          expect(total + packages * content).toBeGreaterThanOrEqual(target);
          expect(total + (packages - 1) * content).toBeLessThan(target);
        },
      ),
    );
  });
});
