import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_INSTALLMENTS,
  MoneyError,
  centsToDecimalString,
  formatDecimalBR,
  formatBRL,
  maskMoneyInput,
  parseBRL,
  splitInstallments,
  sumCents,
  tryParseBRL,
} from './money';

const NBSP = ' ';

describe('parseBRL', () => {
  it.each([
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['1234.56', 123456],
    ['1234', 123400],
    ['0,5', 50],
    ['0,05', 5],
    ['1234.5', 123450],
    ['1.234', 123400],
    ['1.234.567,89', 123456789],
    ['R$ 1.234,56', 123456],
    [`R$${NBSP}10,00`, 1000],
    ['  42,00 ', 4200],
    ['-12,30', -1230],
    ['R$ -12,30', -1230],
    ['-R$ 12,30', -1230],
    ['-0,00', 0],
    ['007,10', 710],
  ])('%s → %i centavos', (input, expected) => {
    expect(parseBRL(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'abc',
    '12,345',
    '1.23.4',
    '12.3456',
    '1,234.56',
    ',50',
    '1234,',
    '1.2345,00',
    '--1',
    '1e3',
  ])('rejeita %j', (input) => {
    const r = tryParseBRL(input);
    expect(r.ok).toBe(false);
    expect(() => parseBRL(input)).toThrow(MoneyError);
  });

  it('rejeita valores acima de R$ 99 bilhões', () => {
    expect(tryParseBRL('100.000.000.000,00')).toEqual({ ok: false, error: 'Valor alto demais.' });
    expect(parseBRL('99.999.999.999,99')).toBe(9_999_999_999_999);
  });

  it('property: formatar e reler devolve os mesmos centavos', () => {
    fc.assert(
      fc.property(fc.integer({ min: -9_999_999_999_999, max: 9_999_999_999_999 }), (cents) => {
        expect(parseBRL(formatBRL(cents))).toBe(cents);
        expect(parseBRL(centsToDecimalString(cents))).toBe(cents);
      }),
    );
  });
});

describe('formatBRL', () => {
  it.each([
    [123456, `R$${NBSP}1.234,56`],
    [5, `R$${NBSP}0,05`],
    [0, `R$${NBSP}0,00`],
    [-1230, `-R$${NBSP}12,30`],
    [9_007_199_254_740_991, `R$${NBSP}90.071.992.547.409,91`],
  ])('%i → %s', (cents, expected) => {
    expect(formatBRL(cents)).toBe(expected);
  });

  it('recusa valores não inteiros', () => {
    expect(() => formatBRL(10.5)).toThrow(MoneyError);
    expect(() => formatBRL(Number.NaN)).toThrow(MoneyError);
  });
});

describe('centsToDecimalString', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [-5, '-0.05'],
    [100, '1.00'],
    [123456, '1234.56'],
  ])('%i → %s', (cents, expected) => expect(centsToDecimalString(cents)).toBe(expected));
});

describe('sumCents', () => {
  it('soma inteiros', () => expect(sumCents([3334, 3333, 3333, -100])).toBe(9900));
  it('recusa parcela não inteira', () => expect(() => sumCents([1, 0.1])).toThrow(MoneyError));
  it('recusa estouro de inteiro seguro', () =>
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow(MoneyError));
});

describe('splitInstallments', () => {
  it('R$ 100 em 3x = 33,34 + 33,33 + 33,33 (resto na 1ª)', () => {
    expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
  });

  it('à vista é uma parcela com o total', () => {
    expect(splitInstallments(18000, 1)).toEqual([18000]);
  });

  it('total igual ao número de parcelas', () => {
    expect(splitInstallments(3, 3)).toEqual([1, 1, 1]);
  });

  it('R$ 1.200 em 12x = 12 × R$ 100', () => {
    expect(splitInstallments(120000, 12)).toEqual(new Array(12).fill(10000));
  });

  it.each([
    [0, 1, 'O valor total precisa ser maior que zero.'],
    [-100, 2, 'O valor total precisa ser maior que zero.'],
    [100.5, 2, 'O valor total precisa ser um número inteiro de centavos.'],
    [100, 0, 'O número de parcelas precisa estar entre 1 e 72.'],
    [100, 73, 'O número de parcelas precisa estar entre 1 e 72.'],
    [100, 2.5, 'O número de parcelas precisa estar entre 1 e 72.'],
    [2, 3, 'Cada parcela precisa ter pelo menos R$ 0,01.'],
  ])('rejeita total=%s em %sx', (total, count, message) => {
    expect(() => splitInstallments(total, count)).toThrow(message);
  });

  const validPlan = fc
    .integer({ min: 1, max: MAX_INSTALLMENTS })
    .chain((count) => fc.tuple(fc.integer({ min: count, max: 9_999_999_999_999 }), fc.constant(count)));

  it('property: Σ parcelas = total, com N parcelas inteiras e positivas', () => {
    fc.assert(
      fc.property(validPlan, ([total, count]) => {
        const parts = splitInstallments(total, count);
        expect(parts).toHaveLength(count);
        expect(sumCents(parts)).toBe(total);
        for (const p of parts) {
          expect(Number.isSafeInteger(p)).toBe(true);
          expect(p).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('property: parcelas 2..N são iguais e o resto (< N) fica só na 1ª', () => {
    fc.assert(
      fc.property(validPlan, ([total, count]) => {
        const [first, ...others] = splitInstallments(total, count);
        const base = Math.floor(total / count);
        for (const p of others) expect(p).toBe(base);
        expect(first! - base).toBeGreaterThanOrEqual(0);
        expect(first! - base).toBeLessThan(count);
      }),
    );
  });
});

describe('formatDecimalBR (valor para pré-preencher input)', () => {
  it.each([
    [123456, '1.234,56'],
    [5, '0,05'],
    [-1230, '-12,30'],
    [0, '0,00'],
  ])('%i → %s', (cents, expected) => expect(formatDecimalBR(cents)).toBe(expected));

  it('property: o parser relê exatamente', () => {
    fc.assert(
      fc.property(fc.integer({ min: -9_999_999_999_999, max: 9_999_999_999_999 }), (c) => {
        expect(parseBRL(formatDecimalBR(c))).toBe(c);
      }),
    );
  });
});

describe('maskMoneyInput (centavos primeiro)', () => {
  it('a vírgula fica antes dos 2 últimos dígitos, com milhar', () => {
    expect(maskMoneyInput('')).toBe('');
    expect(maskMoneyInput('1')).toBe('0,01');
    expect(maskMoneyInput('12')).toBe('0,12');
    expect(maskMoneyInput('123')).toBe('1,23');
    expect(maskMoneyInput('12345')).toBe('123,45');
    expect(maskMoneyInput('123456789')).toBe('1.234.567,89');
  });

  it('é idempotente: remascarar o texto já mascarado não muda nada (apagar e digitar também)', () => {
    expect(maskMoneyInput('1.234,56')).toBe('1.234,56');
    expect(maskMoneyInput('0,0')).toBe(''); // apagou o último dígito de "0,01"
    expect(maskMoneyInput('1.234,5')).toBe('123,45');
  });

  it('ignora zeros à esquerda e o que não é dígito; "-" vira o sinal', () => {
    expect(maskMoneyInput('0001')).toBe('0,01');
    expect(maskMoneyInput('R$ 10,5a')).toBe('1,05');
    expect(maskMoneyInput('-')).toBe('-');
    expect(maskMoneyInput('-1234')).toBe('-12,34');
    expect(maskMoneyInput('12-34')).toBe('-12,34');
  });

  it('limita o tamanho', () => {
    expect(maskMoneyInput('1234567890123456')).toBe('1.234.567.890,12');
  });

  it('property: o texto mascarado é aceito pelo parseBRL e vale os mesmos centavos dos dígitos', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999_999_999_999 }), (cents) => {
        const masked = maskMoneyInput(String(cents));
        expect(parseBRL(masked)).toBe(cents);
        expect(maskMoneyInput(masked)).toBe(masked);
      }),
    );
  });
});
