import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  amountInUnit,
  displayUnit,
  formatAmount,
  formatPackages,
  MAX_BASE_AMOUNT,
  pluralize,
  tryParseAmount,
  type MeasureUnit,
} from './measure';

const parsed = (text: string, unit: MeasureUnit) => {
  const r = tryParseAmount(text, unit);
  return r.ok ? r.value : r.error;
};

describe('tryParseAmount', () => {
  it('kg e L viram gramas e mililitros inteiros, com vírgula ou ponto', () => {
    expect(parsed('1,8', 'kg')).toBe(1800);
    expect(parsed('1.8', 'kg')).toBe(1800);
    expect(parsed('5', 'kg')).toBe(5000);
    expect(parsed('0,5', 'L')).toBe(500);
    expect(parsed('1,250', 'kg')).toBe(1250);
    expect(parsed('20', 'L')).toBe(20_000);
    expect(parsed(' 2,5 ', 'L')).toBe(2500);
  });

  it('g, ml e un são inteiros, com ponto de milhar opcional', () => {
    expect(parsed('500', 'g')).toBe(500);
    expect(parsed('1.500', 'ml')).toBe(1500);
    expect(parsed('12', 'un')).toBe(12);
    expect(parsed('1,5', 'g')).toBe('Em g a quantidade é um número inteiro.');
  });

  it('recusa vazio, zero, negativo, casas demais e texto', () => {
    expect(parsed('', 'kg')).toBe('Informe a quantidade.');
    expect(parsed('0', 'kg')).toBe('A quantidade precisa ser maior que zero.');
    expect(parsed('0,000', 'kg')).toBe('A quantidade precisa ser maior que zero.');
    expect(parsed('-1', 'kg')).toMatch(/inválida/);
    expect(parsed('1,2345', 'kg')).toMatch(/inválida/);
    expect(parsed('abc', 'un')).toBe('Quantidade inválida.');
    expect(parsed('99999999', 'kg')).toBe('Quantidade alta demais.');
  });

  it('propriedade: formatar e ler de volta dá o mesmo inteiro', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_BASE_AMOUNT }),
        fc.constantFrom<MeasureUnit>('kg', 'g', 'L', 'ml', 'un'),
        (value, unit) => {
          const r = tryParseAmount(amountInUnit(value, unit), unit);
          expect(r).toEqual({ ok: true, value });
        },
      ),
    );
  });
});

describe('formatAmount', () => {
  it('troca para kg/L a partir de 1.000, sem zeros à direita', () => {
    expect(formatAmount('WEIGHT', 1800)).toBe('1,8 kg');
    expect(formatAmount('WEIGHT', 19_800)).toBe('19,8 kg');
    expect(formatAmount('WEIGHT', 500)).toBe('500 g');
    expect(formatAmount('WEIGHT', 1_250_000)).toBe('1.250 kg');
    expect(formatAmount('VOLUME', 30_000)).toBe('30 L');
    expect(formatAmount('VOLUME', 1005)).toBe('1,005 L');
    expect(formatAmount('UNIT', 12)).toBe('12 un');
    expect(displayUnit('VOLUME', 999)).toBe('ml');
  });
});

describe('embalagens', () => {
  it('plural do nome da embalagem', () => {
    expect(pluralize('pacote')).toBe('pacotes');
    expect(pluralize('garrafa PET')).toBe('garrafas PET');
    expect(pluralize('galão')).toBe('galões');
    expect(pluralize('barril')).toBe('barris');
    expect(formatPackages(1, 'pacote')).toBe('1 pacote');
    expect(formatPackages(11, 'garrafa PET')).toBe('11 garrafas PET');
    expect(formatPackages(3, 'un')).toBe('3 un');
    expect(formatPackages(1500, 'lata')).toBe('1.500 latas');
  });
});
