/**
 * Gestão de categorias (D49) contra Postgres real (PGlite): criar, renomear, apelidos, arquivar/restaurar,
 * proteção das categorias de fallback e o que acontece com lançamentos de uma categoria arquivada.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { listCategories, listManagedCategories } from '@/db/queries/lookups';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { createCategory, setCategoryArchived, updateCategory } from '@/server/categories';
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
