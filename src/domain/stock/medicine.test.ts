import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { StockError, totalInMeasure } from './quantity';
import {
  isLooseForm,
  MEDICINE_FORMS,
  openedExpiry,
  planOpening,
  type MedicineForm,
  type OpeningSource,
} from './medicine';

const caixa = (over: Partial<OpeningSource> = {}): OpeningSource => ({
  measure: 'UNIT',
  form: 'TABLET',
  openShelfLifeDays: 30,
  packageName: 'caixa',
  contentPerPackage: 10,
  expiryDate: '2027-06-30',
  origin: 'PURCHASE',
  quantity: 2,
  ...over,
});

describe('formas do remédio', () => {
  it('comprimido, cápsula, sachê e supositório contam soltos; o resto não', () => {
    const loose = MEDICINE_FORMS.filter((f) => f.loose).map((f) => f.value);
    expect(loose.sort()).toEqual(['CAPSULE', 'SACHET', 'SUPPOSITORY', 'TABLET']);
    expect(isLooseForm('TABLET')).toBe(true);
    expect(isLooseForm('SYRUP')).toBe(false);
    expect(isLooseForm(null)).toBe(false);
  });
});

describe('openedExpiry (validade depois de aberto)', () => {
  it('abertura + prazo; o menor entre isso e a validade da embalagem fechada', () => {
    expect(openedExpiry('2026-11-06', 30, null)).toBe('2026-12-06');
    expect(openedExpiry('2026-11-06', 30, '2027-06-30')).toBe('2026-12-06');
    expect(openedExpiry('2026-11-06', 30, '2026-11-20')).toBe('2026-11-20');
    expect(openedExpiry('2026-11-06', 30, '2026-12-06')).toBe('2026-12-06');
  });
});

describe('planOpening (Abri)', () => {
  it('comprimido em caixa de 10: o lote aberto tem 10 comprimidos soltos', () => {
    expect(planOpening(caixa(), '2026-11-06')).toEqual({
      packageName: 'comprimido',
      packages: 10,
      contentPerPackage: null,
      expiryDate: '2026-12-06',
    });
  });

  it('xarope: o lote aberto é 1 frasco do mesmo conteúdo', () => {
    const plan = planOpening(
      caixa({
        measure: 'VOLUME',
        form: 'SYRUP',
        packageName: 'frasco',
        contentPerPackage: 120,
        openShelfLifeDays: 15,
        expiryDate: null,
      }),
      '2026-11-06',
    );
    expect(plan).toEqual({
      packageName: 'frasco aberto',
      packages: 1,
      contentPerPackage: 120,
      expiryDate: '2026-11-21',
    });
  });

  it('unidade sem conteúdo (ou de 1 só): 1 embalagem aberta, não há o que contar solto', () => {
    expect(
      planOpening(caixa({ contentPerPackage: null, packageName: 'bisnaga' }), '2026-11-06'),
    ).toMatchObject({ packageName: 'bisnaga aberto', packages: 1, contentPerPackage: null });
    expect(planOpening(caixa({ contentPerPackage: 1 }), '2026-11-06')).toMatchObject({ packages: 1 });
  });

  it('sem forma (produto que não é remédio) nunca conta solto', () => {
    expect(planOpening(caixa({ form: null }), '2026-11-06')).toMatchObject({
      packageName: 'caixa aberto',
      packages: 1,
      contentPerPackage: 10,
    });
  });

  it('recusa: sem prazo depois de aberto, lote já aberto e lote sem embalagem', () => {
    expect(() => planOpening(caixa({ openShelfLifeDays: null }), '2026-11-06')).toThrow(StockError);
    expect(() => planOpening(caixa({ openShelfLifeDays: null }), '2026-11-06')).toThrow('depois de aberto');
    expect(() => planOpening(caixa({ origin: 'OPENED' }), '2026-11-06')).toThrow('já está aberto');
    expect(() => planOpening(caixa({ quantity: 0 }), '2026-11-06')).toThrow('Sem embalagem');
  });

  it('o nome da embalagem aberta cabe em 40 caracteres', () => {
    const plan = planOpening(
      caixa({ form: 'SYRUP', packageName: 'x'.repeat(40), measure: 'VOLUME', contentPerPackage: 100 }),
      '2026-11-06',
    );
    expect(plan.packageName.length).toBeLessThanOrEqual(40);
    expect(plan.packageName.endsWith(' aberto')).toBe(true);
  });

  it('property: abrir nunca muda o total do produto (unidades, g ou ml)', () => {
    const forms = MEDICINE_FORMS.map((f) => f.value) as MedicineForm[];
    fc.assert(
      fc.property(
        fc.constantFrom('UNIT', 'WEIGHT', 'VOLUME'),
        fc.constantFrom(...forms, null),
        fc.option(fc.integer({ min: 1, max: 5_000 }), { nil: null }),
        (measure, form, content) => {
          const lot = caixa({
            measure,
            form,
            contentPerPackage: measure === 'UNIT' ? content : (content ?? 1),
          });
          const plan = planOpening(lot, '2026-11-06');
          const before = totalInMeasure([{ quantity: 1, contentPerPackage: lot.contentPerPackage }]);
          const after = totalInMeasure([
            { quantity: plan.packages, contentPerPackage: plan.contentPerPackage },
          ]);
          expect(after).toBe(before);
        },
      ),
    );
  });
});
