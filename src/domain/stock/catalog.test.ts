import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lotCode, matchesSearch, normalizeText, PREFIX_PATTERN, suggestPrefix } from './catalog';

describe('busca', () => {
  it('ignora acento, maiúsculas e a ordem dos termos', () => {
    expect(normalizeText('  Feijão   PRETO ')).toBe('feijao preto');
    expect(matchesSearch('feijao', ['Feijão preto'])).toBe(true);
    expect(matchesSearch('preto fei', ['Feijão preto'])).toBe(true);
    expect(matchesSearch('agua', ['Galão', 'Água'])).toBe(true);
    expect(matchesSearch('arroz', ['Feijão preto', null])).toBe(false);
    expect(matchesSearch('   ', ['Arroz'])).toBe(false);
  });
});

describe('código do lote', () => {
  it('prefixo + número com 2 dígitos', () => {
    expect(lotCode('ARR', 3)).toBe('ARR-03');
    expect(lotCode('ARR', 123)).toBe('ARR-123');
  });

  it('prefixo sugerido do nome, sem acento', () => {
    expect(suggestPrefix('Arroz branco', [])).toBe('ARR');
    expect(suggestPrefix('Feijão preto', [])).toBe('FEI');
    expect(suggestPrefix('Água', [])).toBe('AGU');
    expect(suggestPrefix('Sal', [])).toBe('SAL');
    expect(suggestPrefix('Ok', [])).toBe('OKX');
  });

  it('desvia dos prefixos já usados', () => {
    expect(suggestPrefix('Arroz integral', ['ARR'])).toBe('AIR');
    expect(suggestPrefix('Arroz integral', ['ARR', 'AIR'])).toBe('ARZ');
    expect(suggestPrefix('Arroz integral', ['ARR', 'AIR', 'ARZ'])).toBe('AR1');
    expect(suggestPrefix('Arroz', ['arr'])).not.toBe('ARR');
  });

  it('propriedade: sempre válido e nunca um prefixo já usado', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 30 }),
        fc.array(fc.stringMatching(/^[A-Z0-9]{2,4}$/), { maxLength: 40 }),
        (name, taken) => {
          const p = suggestPrefix(name, taken);
          expect(p).toMatch(PREFIX_PATTERN);
          expect(taken).not.toContain(p);
        },
      ),
    );
  });
});
