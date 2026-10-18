import { describe, expect, it } from 'vitest';
import {
  findAliasConflicts,
  isProtectedCategory,
  normalizeAlias,
  parseAliases,
  validateCategoryName,
} from './categories';

describe('apelidos do bot', () => {
  it('normaliza: minúsculas, sem acento, símbolos viram espaço', () => {
    expect(normalizeAlias('  Padaria  ')).toBe('padaria');
    expect(normalizeAlias('Açaí & Cia.')).toBe('acai cia');
    expect(normalizeAlias('Plano de SAÚDE')).toBe('plano de saude');
  });

  it('parseAliases separa por vírgula, ponto e vírgula ou linha, sem repetir nem vazios', () => {
    expect(parseAliases('Luz, energia;  Água\nGás,, luz ,')).toEqual(['luz', 'energia', 'agua', 'gas']);
    expect(parseAliases('')).toEqual([]);
    expect(parseAliases(' , ; ')).toEqual([]);
  });

  it('apelido com menos de 2 letras ou mais de 40 é recusado', () => {
    expect(() => parseAliases('a, luz')).toThrow('pelo menos 2');
    expect(() => parseAliases('x'.repeat(41))).toThrow('no máximo 40');
  });

  it('acha apelidos que já pertencem a outra categoria', () => {
    const others = [
      { id: '1', name: 'Mercado', botAliases: ['mercado', 'super'] },
      { id: '2', name: 'Contas da casa', botAliases: ['luz', 'agua'] },
    ];
    expect(findAliasConflicts(['Super', 'padaria', 'água'], others)).toEqual([
      { alias: 'super', categoryName: 'Mercado' },
      { alias: 'agua', categoryName: 'Contas da casa' },
    ]);
    expect(findAliasConflicts(['padaria'], others)).toEqual([]);
  });
});

describe('nome da categoria', () => {
  it('apara e junta espaços; exige de 2 a 60 caracteres', () => {
    expect(validateCategoryName('  Pets   e  bichos ')).toEqual({ ok: true, value: 'Pets e bichos' });
    expect(validateCategoryName(' a ')).toMatchObject({ ok: false });
    expect(validateCategoryName('x'.repeat(61))).toMatchObject({ ok: false });
    expect(validateCategoryName('   ')).toMatchObject({ ok: false });
  });
});

describe('categorias protegidas', () => {
  it('"A classificar" (despesa) e "Outras receitas" (receita) são fallback do bot e das importações', () => {
    expect(isProtectedCategory('EXPENSE', 'A classificar')).toBe(true);
    expect(isProtectedCategory('INCOME', 'Outras receitas')).toBe(true);
    expect(isProtectedCategory('INCOME', 'A classificar')).toBe(false);
    expect(isProtectedCategory('EXPENSE', 'Mercado')).toBe(false);
  });
});
