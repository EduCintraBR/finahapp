/**
 * Estoque da Casa (D81 a D83), contra Postgres real (PGlite): a quantidade mostrada é EXATAMENTE Σ movimentos não
 * cancelados (conferida contra SQL direto), nenhum lote fica negativo (regra e constraint), a saída automática segue
 * o FEFO, o código do lote nunca se repete, e nada da Casa mexe nas Finanças.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { getAccountBalance } from '@/db/queries/balance';
import { grossSpend, monthlySpend, total } from '@/db/queries/reports';
import {
  listStockCategories,
  lotDetail,
  productDetail,
  recentMovements,
  rotationLots,
  shoppingItems,
  stockOverview,
} from '@/db/queries/stock';
import { seed, seedConfigFromEnv } from '@/db/seed';
import type { ServiceCtx } from '@/server/context';
import { createEntry } from '@/server/entries';
import {
  addStockLot,
  archiveStockCategory,
  archiveStockProduct,
  cancelStockMovement,
  checkStockLot,
  countStockLot,
  createStockCategory,
  createStockLocation,
  createStockProduct,
  createSuggestedStockCategories,
  repackStock,
  updateStockProduct,
  consumeStock,
} from '@/server/stock';
import { stockLotInput, stockProductInput, stockRepackInput } from '@/server/stock-schemas';
import { freshDb } from './helpers';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let graos: string;
let agua: string;
let despensa: string;

const HOJE = '2026-11-05';
const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;

/** Referência em SQL direto: Σ movimentos não cancelados por lote. */
async function sqlLotQuantities(productId: string): Promise<Record<string, number>> {
  const rows = await q<{ number: number; qty: string | null }>(
    `select l.number, (select sum(m.quantity) from stock_movements m
        where m.lot_id = l.id and m.cancelled_at is null) as qty
     from stock_lots l where l.product_id = $1 order by l.number`,
    [productId],
  );
  return Object.fromEntries(rows.map((r) => [r.number, Number(r.qty ?? 0)]));
}

const product = (fields: Record<string, string>) =>
  createStockProduct(ctx, stockProductInput.parse({ categoryId: graos, measure: 'WEIGHT', ...fields }));
const lot = (productId: string, fields: Record<string, string>) =>
  addStockLot(ctx, stockLotInput.parse({ productId, entryDate: HOJE, ...fields }));

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
      SEED_OPENING_BALANCE: '5.000,00',
      SEED_OPENING_BALANCE_DATE: '2026-10-01',
    }),
  );
  const eduardo = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId: eduardo, today: HOJE };
  await createSuggestedStockCategories(ctx);
  const cats = await q<{ id: string; name: string }>(`select id, name from stock_categories`);
  graos = cats.find((c) => c.name === 'Grãos')!.id;
  agua = cats.find((c) => c.name === 'Água')!.id;
  despensa = (await createStockLocation(ctx, 'Despensa')).id;
});

describe('categorias sugeridas e cadastros', () => {
  it('cria as categorias em 2 níveis uma vez só; nome repetido e arquivar com produto são recusados', async () => {
    const top = (await listStockCategories(db)).filter((c) => c.parentId === null);
    expect(top.map((t) => t.name)).toEqual([
      'Água',
      'Alimentos',
      'Higiene',
      'Lavanderia',
      'Limpeza',
      'Remédios',
    ]);
    await expect(createSuggestedStockCategories(ctx)).rejects.toThrow('já tem categorias');
    await expect(createStockCategory(ctx, { name: 'graos', parentId: null })).resolves.toBeTruthy();
    const alimentos = (
      await q<{ id: string }>(`select id from stock_categories where name = 'Alimentos'`)
    )[0]!.id;
    await expect(createStockCategory(ctx, { name: 'GRAOS', parentId: alimentos })).rejects.toThrow(
      'Já existe a categoria "Grãos"',
    );
    await expect(createStockCategory(ctx, { name: 'Arroz', parentId: graos })).rejects.toThrow(
      'Subcategoria não tem subcategorias',
    );
    await expect(createStockLocation(ctx, 'despensa')).rejects.toThrow('Já existe o local');
    await product({ name: 'Arroz branco' });
    await expect(archiveStockCategory(ctx, graos)).rejects.toThrow('Há produtos nesta categoria');
  });

  it('código: sugerido do nome, único entre produtos, e trava depois do 1º lote', async () => {
    const arroz = await product({ name: 'Arroz branco' });
    const integral = await product({ name: 'Arroz integral' });
    const prefixes = await q<{ prefix: string }>(`select prefix from stock_products order by created_at`);
    expect(prefixes.map((p) => p.prefix)).toEqual(['ARR', 'AIR']);
    await expect(product({ name: 'Feijão', prefix: 'arr' })).rejects.toThrow(
      'O código ARR já é de outro produto.',
    );
    await expect(product({ name: 'arroz BRANCO' })).rejects.toThrow('Já existe o produto "Arroz branco"');

    await lot(arroz.id, { packages: '2', packageName: 'pacote', contentText: '5', contentUnit: 'kg' });
    const edit = (fields: Record<string, string>) =>
      updateStockProduct(
        ctx,
        arroz.id,
        stockProductInput.parse({ name: 'Arroz branco', categoryId: graos, measure: 'WEIGHT', ...fields }),
      );
    await expect(edit({ prefix: 'ARB' })).rejects.toThrow('o código não muda mais');
    await expect(edit({ measure: 'UNIT' })).rejects.toThrow('a forma de contar não muda mais');
    await expect(edit({ minText: '10', minUnit: 'kg' })).resolves.toBeUndefined();
    // sem lotes, o código ainda muda
    await expect(
      updateStockProduct(
        ctx,
        integral.id,
        stockProductInput.parse({
          name: 'Arroz integral',
          categoryId: graos,
          measure: 'WEIGHT',
          prefix: 'ARI',
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('quantidade = Σ movimentos', () => {
  it('entradas, usos, descarte, contagem e desfazer: a tela bate com o SQL direto', async () => {
    const arroz = await product({
      name: 'Arroz branco',
      minText: '15',
      minUnit: 'kg',
      defaultLocationId: despensa,
    });
    const a1 = await lot(arroz.id, {
      packages: '3',
      packageName: 'pacote',
      contentText: '5',
      contentUnit: 'kg',
      expiryDate: '2027-06-01',
      locationId: despensa,
    });
    const a2 = await lot(arroz.id, {
      packages: '11',
      packageName: 'garrafa PET',
      contentText: '1,8',
      contentUnit: 'kg',
      expiryDate: '2027-03-01',
    });
    expect([a1.code, a2.code]).toEqual(['ARR-01', 'ARR-02']);

    // automático (FEFO): a garrafa vence antes, então sai dela
    expect(
      await consumeStock(ctx, {
        productId: arroz.id,
        kind: 'USE',
        packages: 2,
        lotId: null,
        date: HOJE,
        notes: null,
      }),
    ).toEqual({
      lots: ['ARR-02'],
    });
    // escolhendo o lote
    await consumeStock(ctx, {
      productId: arroz.id,
      kind: 'DISCARD',
      packages: 1,
      lotId: a1.id,
      date: HOJE,
      notes: 'furou',
    });
    const lots = (await productDetail(db, arroz.id, HOJE))!.lots;
    await countStockLot(ctx, {
      lotId: lots.find((l) => l.code === 'ARR-02')!.id,
      counted: 8,
      date: HOJE,
      notes: null,
    });

    const detail = (await productDetail(db, arroz.id, HOJE))!;
    const reference = await sqlLotQuantities(arroz.id);
    expect(Object.fromEntries(detail.lots.map((l) => [l.number, l.quantity]))).toEqual(reference);
    expect(reference).toEqual({ 1: 2, 2: 8 });
    expect(detail.product.packages).toBe(10);
    expect(detail.product.total).toBe(2 * 5000 + 8 * 1800); // 24,4 kg
    expect(detail.product.low).toBe(false);
    expect(detail.product.nextExpiry).toBe('2027-03-01');
    expect(detail.lots.map((l) => l.code)).toEqual(['ARR-02', 'ARR-01']); // ordem de uso

    // desfazer o descarte devolve a embalagem; desfazer de novo é recusado
    const discard = detail.movements.find((m) => m.kind === 'DISCARD')!;
    await cancelStockMovement(ctx, discard.id);
    await expect(cancelStockMovement(ctx, discard.id)).rejects.toThrow('já foi desfeito');
    expect(await sqlLotQuantities(arroz.id)).toEqual({ 1: 3, 2: 8 });

    const overview = (await stockOverview(db, HOJE)).find((p) => p.id === arroz.id)!;
    expect(overview.packages).toBe(11);
    expect(overview.total).toBe(3 * 5000 + 8 * 1800);
    expect(overview.packageNames.sort()).toEqual(['garrafa PET', 'pacote']);
    expect(overview.categoryLabel).toBe('Alimentos › Grãos');
    expect((await recentMovements(db, 3))[0]!.productName).toBe('Arroz branco');
  });

  it('nenhum lote fica negativo: saída maior que o lote, maior que o estoque, desfazer a entrada já usada', async () => {
    const agua5 = await createStockProduct(
      ctx,
      stockProductInput.parse({
        name: 'Água mineral',
        categoryId: agua,
        measure: 'VOLUME',
        minText: '20',
        minUnit: 'L',
      }),
    );
    const l1 = await lot(agua5.id, {
      packages: '2',
      packageName: 'galão',
      contentText: '5',
      contentUnit: 'L',
    });
    await lot(agua5.id, { packages: '1', packageName: 'galão', contentText: '5', contentUnit: 'L' });

    const use = (packages: number, lotId: string | null = null) =>
      consumeStock(ctx, { productId: agua5.id, kind: 'USE', packages, lotId, date: HOJE, notes: null });
    await expect(use(3, l1.id)).rejects.toThrow('O lote AGU-01 tem só 2 embalagens.');
    await expect(use(4)).rejects.toThrow('Só tem 3 embalagens no estoque.');
    await use(3); // sem lote escolhido, esgota os dois
    expect(await sqlLotQuantities(agua5.id)).toEqual({ 1: 0, 2: 0 });
    expect((await stockOverview(db, HOJE)).find((p) => p.id === agua5.id)!.low).toBe(true);
    await expect(use(1)).rejects.toThrow('sem estoque');

    // a entrada do lote 1 não se desfaz: as 2 embalagens já saíram
    const entry = (await productDetail(db, agua5.id, HOJE))!.movements.find(
      (m) => m.kind === 'IN' && m.lotCode === 'AGU-01',
    )!;
    await expect(cancelStockMovement(ctx, entry.id)).rejects.toThrow('O lote AGU-01 ficaria negativo');

    // última linha de defesa: o banco recusa movimento com a direção errada
    await expect(
      q(
        `insert into stock_movements (lot_id, kind, quantity, movement_date, created_by_user_id)
         values ($1, 'USE', 1, $2, $3)`,
        [l1.id, HOJE, ctx.userId],
      ),
    ).rejects.toThrow(/stock_movements_direction/);
  });

  it('peso e volume exigem o conteúdo da embalagem; datas no futuro são recusadas', async () => {
    const feijao = await product({ name: 'Feijão preto' });
    await expect(lot(feijao.id, { packages: '1', packageName: 'pacote' })).rejects.toThrow(
      'Informe o peso de cada embalagem',
    );
    await expect(
      lot(feijao.id, {
        packages: '1',
        packageName: 'pacote',
        contentText: '1',
        contentUnit: 'kg',
        entryDate: '2026-11-06',
      }),
    ).rejects.toThrow('não pode ser no futuro');
    expect(() =>
      stockLotInput.parse({ productId: feijao.id, packages: '0', packageName: 'pacote', entryDate: HOJE }),
    ).toThrow('maior que zero');
  });

  it('arquivar o produto só sem estoque; o código continua reservado', async () => {
    const sal = await product({ name: 'Sal' });
    const l = await lot(sal.id, {
      packages: '1',
      packageName: 'pacote',
      contentText: '1',
      contentUnit: 'kg',
    });
    await expect(archiveStockProduct(ctx, sal.id)).rejects.toThrow('ainda tem estoque');
    await countStockLot(ctx, { lotId: l.id, counted: 0, date: HOJE, notes: null });
    await archiveStockProduct(ctx, sal.id);
    expect((await stockOverview(db, HOJE)).some((p) => p.id === sal.id)).toBe(false);
    await expect(product({ name: 'Sal grosso', prefix: 'SAL' })).rejects.toThrow('já é de outro produto');
  });
});

describe('a Casa não mexe nas Finanças', () => {
  it('saldo, Gasto Bruto, Gasto Mensal e lançamentos ficam iguais depois de tudo na Casa', async () => {
    await createEntry(ctx, {
      kind: 'EXPENSE',
      amount: 12_345,
      description: 'Mercado',
      categoryId: (await q<{ id: string }>(`select id from categories where name = 'Mercado'`))[0]!.id,
      paymentMethod: 'PIX',
      date: '2026-11-03',
      notes: null,
      beneficiaryUserId: null,
    });
    const account = (await q<{ id: string }>(`select id from bank_accounts limit 1`))[0]!.id;
    const snapshot = async () => ({
      balance: await getAccountBalance(db, account, HOJE),
      gross: total(await grossSpend(db, '2026-11-01', '2026-11-30', 'category')),
      monthly: total(await monthlySpend(db, '2026-11-01', '2026-11-30', 'category')),
      transactions: (await q<{ n: string }>(`select count(*) as n from transactions`))[0]!.n,
    });
    const before = await snapshot();

    const arroz = await product({ name: 'Arroz' });
    const l = await lot(arroz.id, {
      packages: '4',
      packageName: 'pacote',
      contentText: '5',
      contentUnit: 'kg',
    });
    await consumeStock(ctx, {
      productId: arroz.id,
      kind: 'USE',
      packages: 1,
      lotId: null,
      date: HOJE,
      notes: null,
    });
    await countStockLot(ctx, { lotId: l.id, counted: 2, date: HOJE, notes: null });

    expect(await snapshot()).toEqual(before);
    const audited = await q<{ entity: string }>(
      `select distinct entity from audit_log where entity like 'stock_%'`,
    );
    expect(audited.map((a) => a.entity).sort()).toEqual([
      'stock_categories',
      'stock_locations',
      'stock_lots',
      'stock_movements',
      'stock_products',
    ]);
  });
});

describe('envase, conferência e rodízio (D84, D85)', () => {
  const repack = (
    productId: string,
    sources: { lotId: string; packages: number }[],
    fields: Record<string, string>,
  ) =>
    repackStock(
      ctx,
      stockRepackInput.parse({
        productId,
        sources,
        packageName: 'garrafa PET',
        contentUnit: 'kg',
        sealDate: HOJE,
        ...fields,
      }),
    );

  it('envasar tira dos pacotes e cria o lote das garrafas, com validade = selagem + prazo, de uma vez', async () => {
    const arroz = await product({ name: 'Arroz', repackShelfLifeMonths: '24', checkEveryMonths: '3' });
    const pacotes = await lot(arroz.id, {
      packages: '4',
      packageName: 'pacote',
      contentText: '5',
      contentUnit: 'kg',
      expiryDate: '2027-02-01', // o pacote vence antes do prazo do envase: vale o envase (D84, resposta "a")
    });
    const garrafas = await repack(arroz.id, [{ lotId: pacotes.id, packages: 2 }], {
      packages: '5',
      contentText: '1,8',
    });
    expect(garrafas.code).toBe('ARR-02');

    expect(await sqlLotQuantities(arroz.id)).toEqual({ 1: 2, 2: 5 });
    const detail = (await lotDetail(db, garrafas.id, HOJE))!;
    expect(detail.lot.origin).toBe('REPACK');
    expect(detail.lot.entryDate).toBe(HOJE);
    expect(detail.lot.expiryDate).toBe('2028-11-05');
    expect(detail.sources).toEqual([{ lotId: pacotes.id, code: 'ARR-01', packages: 2 }]);
    expect((await lotDetail(db, pacotes.id, HOJE))!.repacks).toEqual([
      { lotId: garrafas.id, code: 'ARR-02', packages: 2, opened: false },
    ]);
    // 1ª conferência: selagem + 3 meses
    expect(detail.nextCheck).toBe('2027-02-05');
    expect(detail.checkDue).toBe(false);

    // validade informada vence o cálculo; sem prazo no produto e sem validade, fica sem validade
    const outro = await repack(arroz.id, [{ lotId: pacotes.id, packages: 1 }], {
      packages: '2',
      contentText: '1,8',
      expiryDate: '2027-12-31',
    });
    expect((await lotDetail(db, outro.id, HOJE))!.lot.expiryDate).toBe('2027-12-31');
  });

  it('envase é tudo ou nada: origem sem estoque recusa e não cria nada', async () => {
    const feijao = await product({ name: 'Feijão' });
    const p = await lot(feijao.id, {
      packages: '1',
      packageName: 'pacote',
      contentText: '1',
      contentUnit: 'kg',
    });
    await expect(
      repack(feijao.id, [{ lotId: p.id, packages: 2 }], { packages: '1', contentText: '1' }),
    ).rejects.toThrow('O lote FEI-01 tem só 1 embalagem.');
    await expect(
      repack(feijao.id, [{ lotId: p.id, packages: 0 }], { packages: '1', contentText: '1' }),
    ).rejects.toThrow('Escolha de qual lote');
    expect(await sqlLotQuantities(feijao.id)).toEqual({ 1: 1 });
  });

  it('desfazer o envase desfaz tudo; com garrafa já aberta, recusa', async () => {
    const arroz = await product({ name: 'Arroz' });
    const p = await lot(arroz.id, {
      packages: '3',
      packageName: 'pacote',
      contentText: '5',
      contentUnit: 'kg',
    });
    const g = await repack(arroz.id, [{ lotId: p.id, packages: 2 }], { packages: '5', contentText: '1,8' });
    await consumeStock(ctx, {
      productId: arroz.id,
      kind: 'USE',
      packages: 1,
      lotId: g.id,
      date: HOJE,
      notes: null,
    });

    const moves = (await productDetail(db, arroz.id, HOJE))!.movements;
    const repackOut = moves.find((m) => m.kind === 'REPACK_OUT')!;
    await expect(cancelStockMovement(ctx, repackOut.id)).rejects.toThrow(
      'Parte das embalagens do ARR-02 já saiu',
    );

    await cancelStockMovement(ctx, moves.find((m) => m.kind === 'USE')!.id);
    await cancelStockMovement(ctx, repackOut.id); // pela saída do pacote: desfaz o envase inteiro
    expect(await sqlLotQuantities(arroz.id)).toEqual({ 1: 3, 2: 0 });
    const cancelled = await q<{ kind: string }>(
      `select kind from stock_movements where cancelled_at is not null order by kind`,
    );
    expect(cancelled.map((c) => c.kind).sort()).toEqual(['REPACK_IN', 'REPACK_OUT', 'USE']);
  });

  it('conferência: "Conferi" empurra a próxima; atrasada aparece no rodízio', async () => {
    const agua5 = await createStockProduct(
      ctx,
      stockProductInput.parse({
        name: 'Água',
        categoryId: agua,
        measure: 'VOLUME',
        expiryKind: 'REPLACE_BY',
        checkEveryMonths: '2',
      }),
    );
    const l = await lot(agua5.id, {
      packages: '6',
      packageName: 'galão',
      contentText: '5',
      contentUnit: 'L',
      entryDate: '2026-08-01',
      expiryDate: '2026-11-20',
    });
    let rot = (await rotationLots(db, HOJE)).find((r) => r.id === l.id)!;
    expect(rot.nextCheck).toBe('2026-10-01');
    expect(rot.checkDue).toBe(true);
    expect(rot.expiry).toBe('soon');
    expect(rot.expiryKind).toBe('REPLACE_BY');

    await checkStockLot(ctx, { lotId: l.id, date: HOJE, notes: 'vedação ok' });
    rot = (await rotationLots(db, HOJE)).find((r) => r.id === l.id)!;
    expect(rot.nextCheck).toBe('2027-01-05');
    expect(rot.checkDue).toBe(false);
    expect((await lotDetail(db, l.id, HOJE))!.checks.map((c) => c.notes)).toEqual(['vedação ok']);
    await expect(checkStockLot(ctx, { lotId: l.id, date: '2026-07-01', notes: null })).rejects.toThrow(
      'antes da entrada',
    );
    await expect(checkStockLot(ctx, { lotId: l.id, date: '2026-11-06', notes: null })).rejects.toThrow(
      'futuro',
    );
  });

  it('reposição (D86): acabando = abaixo do mínimo; a lista de compras é derivada e acompanha as entradas e saídas', async () => {
    const arroz = await product({
      name: 'Arroz',
      minText: '10',
      minUnit: 'kg',
      targetText: '30',
      targetUnit: 'kg',
      defaultPackage: 'pacote',
      defaultContentText: '5',
      contentUnit: 'kg',
    });
    // sem entrada: zero, abaixo do mínimo; falta a meta inteira, em 6 pacotes de 5 kg
    let [item] = shoppingItems(await stockOverview(db, HOJE));
    expect(item).toMatchObject({ id: arroz.id, total: 0, low: true });
    expect(item!.need).toEqual({ reference: 30_000, missing: 30_000, packages: 6, belowMin: true });

    // 2 pacotes de 5 kg = 10 kg: no mínimo (não está mais acabando), mas ainda faltam 20 kg para a meta
    const l = await lot(arroz.id, {
      packages: '2',
      packageName: 'pacote',
      contentText: '5',
      contentUnit: 'kg',
    });
    let overview = await stockOverview(db, HOJE);
    expect(overview.find((p) => p.id === arroz.id)!.low).toBe(false);
    [item] = shoppingItems(overview);
    expect(item!.need).toEqual({ reference: 30_000, missing: 20_000, packages: 4, belowMin: false });

    // usou 1: 5 kg, abaixo do mínimo de novo
    await consumeStock(ctx, {
      productId: arroz.id,
      kind: 'USE',
      packages: 1,
      lotId: l.id,
      date: HOJE,
      notes: null,
    });
    overview = await stockOverview(db, HOJE);
    expect(overview.find((p) => p.id === arroz.id)).toMatchObject({ low: true, total: 5_000 });
    expect(shoppingItems(overview)[0]!.need).toMatchObject({ missing: 25_000, packages: 5, belowMin: true });

    // a compra sugerida (5 pacotes) chega exatamente na meta e tira o produto da lista
    await lot(arroz.id, { packages: '5', packageName: 'pacote', contentText: '5', contentUnit: 'kg' });
    overview = await stockOverview(db, HOJE);
    expect(overview.find((p) => p.id === arroz.id)!.total).toBe(30_000);
    expect(shoppingItems(overview)).toEqual([]);

    // produto sem mínimo nem meta nunca entra na lista; nada foi guardado: a lista não tem tabela
    await product({ name: 'Sal' });
    expect(shoppingItems(await stockOverview(db, HOJE))).toEqual([]);
  });

  it('a lista põe o que está acabando primeiro, depois por categoria e nome', async () => {
    const feijao = await product({
      name: 'Feijão',
      minText: '2',
      minUnit: 'kg',
      targetText: '6',
      targetUnit: 'kg',
    });
    const macarrao = await product({ name: 'Macarrão', targetText: '3', targetUnit: 'kg' });
    const sabao = await createStockProduct(
      ctx,
      stockProductInput.parse({
        name: 'Sabão',
        categoryId: agua,
        measure: 'UNIT',
        minText: '2',
        targetText: '4',
      }),
    );
    await lot(macarrao.id, { packages: '1', packageName: 'pacote', contentText: '1', contentUnit: 'kg' });
    const list = shoppingItems(await stockOverview(db, HOJE));
    expect(list.map((i) => i.name)).toEqual(['Sabão', 'Feijão', 'Macarrão']);
    expect(list.map((i) => i.need.belowMin)).toEqual([true, true, false]);
    expect(list.find((i) => i.id === sabao.id)!.need).toMatchObject({ missing: 4, packages: 4 });
    expect(list.find((i) => i.id === feijao.id)!.need).toMatchObject({ missing: 6_000, packages: null });
  });
});
