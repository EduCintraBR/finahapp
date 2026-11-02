import { describe, expect, it } from 'vitest';
import {
  categoryLabel,
  findAliasConflicts,
  findNameClash,
  isProtectedCategory,
  normalizeAlias,
  parseAliases,
  validateCategoryName,
  validateParent,
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

describe('subcategorias (D74)', () => {
  const mercado = { id: 'm', kind: 'EXPENSE', parentId: null, name: 'Mercado', archived: false } as const;
  const hortifruti = { ...mercado, id: 'h', parentId: 'm', name: 'Hortifruti' };
  const salario = { ...mercado, id: 's', kind: 'INCOME', name: 'Salário' } as const;

  it('uma categoria sem filhas pode virar subcategoria de uma categoria de mesmo tipo', () => {
    expect(validateParent({ id: 'x', kind: 'EXPENSE', name: 'Feira', hasChildren: false }, mercado)).toEqual({
      ok: true,
    });
  });

  it('tirar do grupo (mãe nula) é sempre permitido', () => {
    expect(
      validateParent({ id: 'h', kind: 'EXPENSE', name: 'Hortifruti', hasChildren: false }, null),
    ).toEqual({
      ok: true,
    });
  });

  it('recusa mais de 2 níveis, mãe de outro tipo, mãe arquivada, ela mesma e categoria com filhas', () => {
    const child = { id: 'x', kind: 'EXPENSE', name: 'Feira', hasChildren: false } as const;
    expect(validateParent(child, hortifruti)).toMatchObject({
      ok: false,
      error: expect.stringContaining('2 níveis'),
    });
    expect(validateParent(child, salario)).toMatchObject({
      ok: false,
      error: expect.stringContaining('mesmo tipo'),
    });
    expect(validateParent(child, { ...mercado, archived: true })).toMatchObject({
      ok: false,
      error: expect.stringContaining('arquivada'),
    });
    expect(validateParent({ ...child, id: 'm' }, mercado)).toMatchObject({ ok: false });
    expect(validateParent({ ...child, hasChildren: true }, mercado)).toMatchObject({
      ok: false,
      error: expect.stringContaining('subcategorias'),
    });
  });

  it('as categorias protegidas do sistema não viram subcategoria', () => {
    expect(
      validateParent({ id: 'c', kind: 'EXPENSE', name: 'A classificar', hasChildren: false }, mercado),
    ).toMatchObject({ ok: false, error: expect.stringContaining('A classificar') });
  });

  it('o nome da subcategoria só não pode repetir entre irmãs (sem diferenciar acento nem caixa)', () => {
    const siblings = [{ id: 'h', name: 'Hortifrúti' }];
    expect(findNameClash('hortifruti', siblings, null)).toEqual({ id: 'h', name: 'Hortifrúti' });
    expect(findNameClash('hortifruti', siblings, 'h')).toBeUndefined();
    expect(findNameClash('açougue', siblings, null)).toBeUndefined();
  });

  it('rótulo "Mãe › Filha" só quando há mãe', () => {
    expect(categoryLabel('Hortifruti', 'Mercado')).toBe('Mercado › Hortifruti');
    expect(categoryLabel('Mercado', null)).toBe('Mercado');
  });
});
