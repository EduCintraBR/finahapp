/**
 * Gestão de categorias (D49) contra Postgres real (PGlite): criar, renomear, apelidos, arquivar/restaurar,
 * proteção das categorias de fallback e o que acontece com lançamentos de uma categoria arquivada.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { listEntries } from '@/db/queries/entries';
import { listCategories, listManagedCategories } from '@/db/queries/lookups';
import { grossSpend, monthlySpend } from '@/db/queries/reports';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { createCategory, moveCategory, setCategoryArchived, updateCategory } from '@/server/categories';
import type { ServiceCtx } from '@/server/context';
import { createEntry, updateEntry } from '@/server/entries';
import { freshDb } from './helpers';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
const cat: Record<string, string> = {};

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;

beforeEach(async () => {
  ({ pg, db } = await freshDb());
  await seed(
    db,
    seedConfigFromEnv({
      SEED_USER1_NAME: 'Eduardo',
      SEED_USER1_EMAIL: 'eduardo@example.com',
      SEED_USER1_PASSWORD: 'senha-do-eduardo',
      SEED_USER2_NAME: 'Viviane',
      SEED_USER2_EMAIL: 'viviane@example.com',
      SEED_USER2_PASSWORD: 'senha-da-viviane',
      SEED_OPENING_BALANCE: '1.000,00',
      SEED_OPENING_BALANCE_DATE: '2026-10-01',
    }),
  );
  for (const r of await q<{ id: string; name: string }>(`select id, name from categories`))
    cat[r.name] = r.id;
  const userId = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId, today: '2026-10-18' };
});

const entry = (categoryId: string, description = 'Ração') =>
  createEntry(ctx, {
    kind: 'EXPENSE',
    amount: 5_000,
    description,
    categoryId,
    paymentMethod: 'PIX',
    date: '2026-10-10',
    beneficiaryUserId: null,
    notes: null,
  });

describe('criar e editar', () => {
  it('cria com apelidos, usa na hora e grava audit_log', async () => {
    const { id } = await createCategory(ctx, {
      kind: 'EXPENSE',
      name: '  Pets  ',
      aliases: ['racao', 'petshop'],
    });
    const [row] = await q<{ name: string; bot_aliases: string[] }>(
      `select name, bot_aliases from categories where id = $1`,
      [id],
    );
    expect(row).toEqual({ name: 'Pets', bot_aliases: ['racao', 'petshop'] });
    await entry(id);
    expect(await q(`select 1 from audit_log where entity = 'categories' and action = 'CREATE'`)).toHaveLength(
      1,
    );
  });

  it('recusa nome repetido no mesmo tipo (sem diferenciar maiúsculas nem acento), mas aceita em outro tipo', async () => {
    await expect(createCategory(ctx, { kind: 'EXPENSE', name: 'MERCADO', aliases: [] })).rejects.toThrow(
      'Já existe uma categoria chamada "Mercado"',
    );
    await expect(createCategory(ctx, { kind: 'EXPENSE', name: 'educacao', aliases: [] })).rejects.toThrow(
      'Já existe',
    );
    await expect(createCategory(ctx, { kind: 'INCOME', name: 'Mercado', aliases: [] })).resolves.toBeTruthy();
    await expect(createCategory(ctx, { kind: 'EXPENSE', name: ' ', aliases: [] })).rejects.toThrow(
      'Informe o nome',
    );
  });

  it('recusa apelido que já é de outra categoria, dizendo de qual', async () => {
    await expect(createCategory(ctx, { kind: 'EXPENSE', name: 'Pets', aliases: ['super'] })).rejects.toThrow(
      'O apelido "super" já é da categoria "Mercado"',
    );
    // apelido de categoria de receita não conflita com despesa
    await expect(
      createCategory(ctx, { kind: 'EXPENSE', name: 'Pets', aliases: ['salario'] }),
    ).resolves.toBeTruthy();
  });

  it('renomeia e troca apelidos; só confere os apelidos que foram adicionados', async () => {
    await updateCategory(ctx, cat['Mercado']!, {
      name: 'Supermercado',
      aliases: ['mercado', 'super', 'atacado'],
    });
    const [row] = await q<{ name: string; bot_aliases: string[] }>(
      `select name, bot_aliases from categories where id = $1`,
      [cat['Mercado']!],
    );
    expect(row!.name).toBe('Supermercado');
    expect(row!.bot_aliases).toContain('atacado');
    await expect(
      updateCategory(ctx, cat['Mercado']!, { name: 'Supermercado', aliases: ['luz'] }),
    ).rejects.toThrow('já é da categoria "Contas da casa"');
    const audits = await q<{ before: { name: string }; after: { name: string } }>(
      `select before, after from audit_log where entity = 'categories' and action = 'UPDATE' order by created_at`,
    );
    expect(audits[0]).toMatchObject({ before: { name: 'Mercado' }, after: { name: 'Supermercado' } });
  });
});

describe('categorias protegidas', () => {
  it('"A classificar" e "Outras receitas" não podem ser renomeadas nem arquivadas (mas os apelidos podem mudar)', async () => {
    await expect(
      updateCategory(ctx, cat['A classificar']!, { name: 'Diversos', aliases: [] }),
    ).rejects.toThrow('não pode ser renomeada');
    await expect(setCategoryArchived(ctx, cat['A classificar']!, true)).rejects.toThrow(
      'não pode ser arquivada',
    );
    await expect(setCategoryArchived(ctx, cat['Outras receitas']!, true)).rejects.toThrow(
      'não pode ser arquivada',
    );
    await expect(
      updateCategory(ctx, cat['A classificar']!, { name: 'A classificar', aliases: ['diversos'] }),
    ).resolves.toBeUndefined();
  });
});

describe('arquivar e restaurar', () => {
  it('some das listas de escolha, mas lançamentos antigos, edição e relatórios continuam com ela', async () => {
    const { id } = await entry(cat['Lazer']!, 'Cinema');
    await setCategoryArchived(ctx, cat['Lazer']!, true);

    expect((await listCategories(db)).some((c) => c.id === cat['Lazer'])).toBe(false);
    expect((await listCategories(db, { includeArchived: true })).some((c) => c.id === cat['Lazer'])).toBe(
      true,
    );
    expect((await listCategories(db, { alsoIds: [cat['Lazer']] })).some((c) => c.id === cat['Lazer'])).toBe(
      true,
    );

    // lançamento novo nela: recusado
    await expect(entry(cat['Lazer']!, 'Show')).rejects.toThrow('Categoria não encontrada');

    // o lançamento antigo continua editável sem trocar de categoria...
    const [t] = await q<{ version: number }>(`select version from transactions where id = $1`, [id]);
    await updateEntry(ctx, id, t!.version, {
      kind: 'EXPENSE',
      amount: 6_000,
      description: 'Cinema com pipoca',
      categoryId: cat['Lazer']!,
      paymentMethod: 'PIX',
      date: '2026-10-10',
      beneficiaryUserId: null,
      notes: null,
    });
    expect(
      (await q<{ category_id: string }>(`select category_id from transactions where id = $1`, [id]))[0]!
        .category_id,
    ).toBe(cat['Lazer']);

    // ...mas não pode ser movido para OUTRA categoria arquivada
    await setCategoryArchived(ctx, cat['Viagens']!, true);
    const [t2] = await q<{ version: number }>(`select version from transactions where id = $1`, [id]);
    await expect(
      updateEntry(ctx, id, t2!.version, {
        kind: 'EXPENSE',
        amount: 6_000,
        description: 'Cinema com pipoca',
        categoryId: cat['Viagens']!,
        paymentMethod: 'PIX',
        date: '2026-10-10',
        beneficiaryUserId: null,
        notes: null,
      }),
    ).rejects.toThrow('Categoria não encontrada');

    // restaurar volta tudo
    await setCategoryArchived(ctx, cat['Lazer']!, false);
    expect((await listCategories(db)).some((c) => c.id === cat['Lazer'])).toBe(true);
    await expect(entry(cat['Lazer']!, 'Show')).resolves.toBeTruthy();
  });

  it('restaurar não pode criar apelido duplicado com outra categoria ativa', async () => {
    await setCategoryArchived(ctx, cat['Compras']!, true);
    await updateCategory(ctx, cat['Lazer']!, { name: 'Lazer', aliases: ['cinema', 'amazon'] });
    await expect(setCategoryArchived(ctx, cat['Compras']!, false)).rejects.toThrow(
      'O apelido "amazon" já é da categoria "Lazer"',
    );
  });

  it('nome de categoria arquivada ainda conta como repetido: a mensagem manda restaurar', async () => {
    await setCategoryArchived(ctx, cat['Presentes']!, true);
    await expect(createCategory(ctx, { kind: 'EXPENSE', name: 'Presentes', aliases: [] })).rejects.toThrow(
      'arquivada: restaure-a',
    );
  });

  it('arquivar duas vezes não faz nada; categoria inexistente dá erro em pt-BR', async () => {
    await setCategoryArchived(ctx, cat['Lazer']!, true);
    await expect(setCategoryArchived(ctx, cat['Lazer']!, true)).resolves.toBeUndefined();
    expect(await q(`select 1 from audit_log where entity = 'categories' and action = 'UPDATE'`)).toHaveLength(
      1,
    );
    await expect(setCategoryArchived(ctx, '00000000-0000-4000-8000-000000000000', true)).rejects.toThrow(
      'Categoria não encontrada',
    );
  });
});

describe('tela de gestão', () => {
  it('conta quantos lançamentos usam cada categoria (sem os apagados) e lista as arquivadas', async () => {
    await entry(cat['Mercado']!, 'Compras da semana');
    const { id } = await entry(cat['Mercado']!, 'Feira');
    await q(`update transactions set deleted_at = now() where id = $1`, [id]);
    await setCategoryArchived(ctx, cat['Presentes']!, true);

    const all = await listManagedCategories(db);
    expect(all.find((c) => c.name === 'Mercado')).toMatchObject({ usageCount: 1, archived: false });
    expect(all.find((c) => c.name === 'Presentes')).toMatchObject({ usageCount: 0, archived: true });
    expect(all.find((c) => c.name === 'Lazer')!.usageCount).toBe(0);
  });
});

describe('subcategorias (D74)', () => {
  const sub = (name: string, parentId: string, aliases: string[] = []) =>
    createCategory(ctx, { kind: 'EXPENSE', name, aliases, parentId });
  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const gross = (f = {}) => grossSpend(db, '2026-10-01', '2026-10-31', 'category', f);

  it('cria subcategoria com o tipo da mãe, aparece nas listas e grava audit_log com a mãe', async () => {
    const { id } = await sub('Hortifruti Orgânico', cat['Mercado']!, ['sacolao']);
    const [row] = await q<{ kind: string; parent_id: string }>(
      `select kind, parent_id from categories where id = $1`,
      [id],
    );
    expect(row).toEqual({ kind: 'EXPENSE', parent_id: cat['Mercado'] });
    expect((await listCategories(db)).find((c) => c.id === id)).toMatchObject({ parentId: cat['Mercado'] });
    expect((await listManagedCategories(db)).find((c) => c.id === id)).toMatchObject({
      parentId: cat['Mercado'],
    });
    const [log] = await q<{ after: { parentId: string } }>(
      `select after from audit_log where entity = 'categories' and entity_id = $1`,
      [id],
    );
    expect(log!.after.parentId).toBe(cat['Mercado']);
  });

  it('o nome só não pode repetir entre irmãs: o mesmo nome em outra mãe é aceito', async () => {
    await sub('Aplicativo', cat['Transporte']!);
    await expect(sub('aplicativo', cat['Transporte']!)).rejects.toThrow('Já existe uma categoria chamada');
    await expect(sub('Aplicativo', cat['Lazer']!)).resolves.toBeTruthy();
  });

  it('apelido continua único no tipo inteiro, mães e subcategorias juntas', async () => {
    await expect(sub('Hortifruti Orgânico', cat['Mercado']!, ['mercado'])).rejects.toThrow(
      'já é da categoria',
    );
  });

  it('só 2 níveis, mesmo tipo e mãe ativa', async () => {
    const { id } = await sub('Hortifruti Orgânico', cat['Mercado']!);
    await expect(sub('Frutas', id)).rejects.toThrow('2 níveis');
    // despesa não pode ter subcategoria de receita (nem o contrário)
    await expect(
      createCategory(ctx, { kind: 'INCOME', name: 'Extra', aliases: [], parentId: cat['Mercado']! }),
    ).rejects.toThrow('mesmo tipo');
    await setCategoryArchived(ctx, cat['Lazer']!, true);
    await expect(sub('Cinema', cat['Lazer']!)).rejects.toThrow('arquivada');
  });

  it('mover para dentro de outra categoria não toca nos lançamentos e reagrupa o histórico na mãe', async () => {
    await entry(cat['Mercado']!, 'Compras da semana'); // 50,00
    const { id: appCat } = await createCategory(ctx, { kind: 'EXPENSE', name: 'Aplicativo', aliases: [] });
    await entry(appCat, 'Corrida'); // 50,00
    const before = await gross();
    expect(before.get(appCat)).toBe(5_000);
    expect(before.get(cat['Transporte']!)).toBeUndefined();

    await moveCategory(ctx, appCat, cat['Transporte']!);

    const after = await gross();
    expect(after.get(appCat)).toBeUndefined();
    expect(after.get(cat['Transporte']!)).toBe(5_000); // somou na mãe
    expect(after.get(cat['Mercado']!)).toBe(before.get(cat['Mercado']!));
    expect(total(after)).toBe(total(before)); // nenhum centavo muda de lugar além da fatia
    const [tx] = await q<{ category_id: string }>(
      `select category_id from transactions where description = 'Corrida'`,
    );
    expect(tx!.category_id).toBe(appCat); // lançamento intocado

    await moveCategory(ctx, appCat, null); // voltar ao topo desfaz
    expect((await gross()).get(appCat)).toBe(5_000);
  });

  it('o Gasto Mensal também soma pela mãe, e o filtro de categoria inclui as subcategorias', async () => {
    const { id: hort } = await sub('Hortifruti Orgânico', cat['Mercado']!);
    await entry(cat['Mercado']!, 'Compras da semana');
    await entry(hort, 'Feira');
    const mensal = await monthlySpend(db, '2026-10-01', '2026-10-31', 'category');
    expect(mensal.get(cat['Mercado']!)).toBe(10_000);
    expect(mensal.get(hort)).toBeUndefined();

    expect((await gross({ categoryId: cat['Mercado']! })).get(cat['Mercado']!)).toBe(10_000);
    expect((await gross({ categoryId: hort })).get(cat['Mercado']!)).toBe(5_000);

    const mae = await listEntries(db, { month: '2026-10-01', categoryId: cat['Mercado']! });
    expect(mae.map((e) => e.description).sort()).toEqual(['Compras da semana', 'Feira']);
    const filha = await listEntries(db, { month: '2026-10-01', categoryId: hort });
    expect(filha.map((e) => e.description)).toEqual(['Feira']);
    expect(filha[0]!.categoryName).toBe('Mercado › Hortifruti Orgânico');
    expect(mae.find((e) => e.description === 'Compras da semana')!.categoryName).toBe('Mercado');
  });

  it('não move categoria com subcategorias, nem as protegidas, nem para mãe de outro tipo', async () => {
    await sub('Hortifruti Orgânico', cat['Mercado']!);
    await expect(moveCategory(ctx, cat['Mercado']!, cat['Lazer']!)).rejects.toThrow('tem subcategorias');
    await expect(moveCategory(ctx, cat['A classificar']!, cat['Lazer']!)).rejects.toThrow('A classificar');
    await expect(moveCategory(ctx, cat['Lazer']!, cat['Salário CLT']!)).rejects.toThrow('mesmo tipo');
    await expect(moveCategory(ctx, cat['Lazer']!, cat['Lazer']!)).rejects.toThrow('dentro dela mesma');
  });

  it('arquivar a mãe exige arquivar/mover as subcategorias antes; restaurar a filha exige a mãe ativa', async () => {
    const { id } = await sub('Hortifruti Orgânico', cat['Mercado']!);
    await expect(setCategoryArchived(ctx, cat['Mercado']!, true)).rejects.toThrow('subcategoria ativa');
    await setCategoryArchived(ctx, id, true);
    await setCategoryArchived(ctx, cat['Mercado']!, true);
    await expect(setCategoryArchived(ctx, id, false)).rejects.toThrow('Restaure a categoria "Mercado"');
    await setCategoryArchived(ctx, cat['Mercado']!, false);
    await expect(setCategoryArchived(ctx, id, false)).resolves.toBeUndefined();
  });
});
