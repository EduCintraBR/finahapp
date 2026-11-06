/**
 * Remédios, para quem e embalagem aberta (D88 a D90), contra Postgres real (PGlite): o "Abri" tira 1 embalagem e
 * cria o lote aberto numa transação só (o total do produto não muda), a quantidade segue sendo Σ movimentos não
 * cancelados, o desfazer volta a operação inteira e nada disso toca as Finanças.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { getAccountBalance } from '@/db/queries/balance';
import { grossSpend, monthlySpend, total } from '@/db/queries/reports';
import { listStockPeople, lotDetail, productDetail, stockOverview } from '@/db/queries/stock';
import { seed, seedConfigFromEnv } from '@/db/seed';
import type { ServiceCtx } from '@/server/context';
import {
  addStockLot,
  archiveStockPerson,
  cancelStockMovement,
  consumeStock,
  createStockPerson,
  createSuggestedStockCategories,
  createSuggestedStockPeople,
  createStockProduct,
  openStockLot,
  renameStockPerson,
  updateStockProduct,
} from '@/server/stock';
import { stockLotInput, stockOpenInput, stockProductInput, stockUseInput } from '@/server/stock-schemas';
import { freshDb } from './helpers';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let remedios: string;

const HOJE = '2026-11-05';
const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;

/** Referência em SQL direto: Σ movimentos não cancelados por lote (número do lote → embalagens). */
async function sqlLotQuantities(productId: string): Promise<Record<number, number>> {
  const rows = await q<{ number: number; qty: string | null }>(
    `select l.number, (select sum(m.quantity) from stock_movements m
        where m.lot_id = l.id and m.cancelled_at is null) as qty
     from stock_lots l where l.product_id = $1 order by l.number`,
    [productId],
  );
  return Object.fromEntries(rows.map((r) => [r.number, Number(r.qty ?? 0)]));
}

const medicine = (fields: Record<string, unknown>) =>
  createStockProduct(
    ctx,
    stockProductInput.parse({
      categoryId: remedios,
      measure: 'UNIT',
      isMedicine: 'on',
      medicineForm: 'TABLET',
      openShelfLifeDays: '60',
      ...fields,
    }),
  );
const lot = (productId: string, fields: Record<string, string>) =>
  addStockLot(ctx, stockLotInput.parse({ productId, entryDate: HOJE, ...fields }));
const open = (lotId: string, date = HOJE) => openStockLot(ctx, stockOpenInput.parse({ lotId, date }));
const use = (productId: string, lotId: string, packages: number) =>
  consumeStock(
    ctx,
    stockUseInput.parse({ productId, kind: 'USE', packages: String(packages), lotId, date: HOJE }),
  );

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
  remedios = (await q<{ id: string }>(`select id from stock_categories where name = 'Remédios'`))[0]!.id;
});

describe('pessoas e bichos da casa (D89)', () => {
  it('os sugeridos são os usuários, a Liz e a Molly; só quando a lista está vazia', async () => {
    await createSuggestedStockPeople(ctx);
    expect((await listStockPeople(db)).map((p) => p.name)).toEqual(['Eduardo', 'Liz', 'Molly', 'Viviane']);
    await expect(createSuggestedStockPeople(ctx)).rejects.toThrow('já tem nomes');
    await expect(createStockPerson(ctx, 'liz')).rejects.toThrow('Já existe "Liz"');
  });

  it('renomear e remover (arquivar); o produto continua mostrando quem era', async () => {
    const liz = await createStockPerson(ctx, 'Liz');
    const molly = await createStockPerson(ctx, 'Molly');
    const prod = await medicine({ name: 'Dipirona', personIds: [liz.id, molly.id] });
    await renameStockPerson(ctx, molly.id, 'Molly (cachorra)');
    await archiveStockPerson(ctx, molly.id);
    expect((await listStockPeople(db)).map((p) => p.name)).toEqual(['Liz']);
    const { product } = (await productDetail(db, prod.id, HOJE))!;
    expect(product.people.map((p) => p.name)).toEqual(['Liz', 'Molly (cachorra)']);
    // não dá para escolher quem foi removido
    await expect(
      updateStockProduct(
        ctx,
        prod.id,
        stockProductInput.parse({
          name: 'Dipirona',
          categoryId: remedios,
          measure: 'UNIT',
          isMedicine: 'on',
          medicineForm: 'TABLET',
          personIds: [molly.id],
        }),
      ),
    ).rejects.toThrow('Pessoa não encontrada');
  });
});

describe('remédio (D88)', () => {
  it('guarda princípio ativo, dosagem, forma e para quem; a lista de pessoas é trocada ao editar', async () => {
    const liz = await createStockPerson(ctx, 'Liz');
    const edu = await createStockPerson(ctx, 'Eduardo');
    const prod = await medicine({
      name: 'Dorflex',
      activeIngredient: 'dipirona',
      strength: '300 mg',
      personIds: [liz.id, edu.id],
    });
    let p = (await stockOverview(db, HOJE)).find((x) => x.id === prod.id)!;
    expect(p).toMatchObject({
      isMedicine: true,
      activeIngredient: 'dipirona',
      strength: '300 mg',
      medicineForm: 'TABLET',
      openShelfLifeDays: 60,
    });
    expect(p.people.map((x) => x.name)).toEqual(['Eduardo', 'Liz']);

    await updateStockProduct(
      ctx,
      prod.id,
      stockProductInput.parse({
        name: 'Dorflex',
        categoryId: remedios,
        measure: 'UNIT',
        isMedicine: 'on',
        medicineForm: 'TABLET',
        activeIngredient: 'dipirona',
        personIds: [liz.id],
      }),
    );
    p = (await stockOverview(db, HOJE)).find((x) => x.id === prod.id)!;
    expect(p.people.map((x) => x.name)).toEqual(['Liz']);
    expect(p.strength).toBeNull();
    expect(p.openShelfLifeDays).toBeNull();
  });

  it('remédio exige a forma; produto que não é remédio não guarda os campos do remédio', async () => {
    expect(() =>
      stockProductInput.parse({ name: 'X', categoryId: remedios, measure: 'UNIT', isMedicine: 'on' }),
    ).toThrow('forma do remédio');
    const parsed = stockProductInput.parse({
      name: 'Detergente',
      categoryId: remedios,
      measure: 'UNIT',
      activeIngredient: 'ignorado',
      strength: 'ignorado',
      medicineForm: 'SYRUP',
    });
    expect(parsed).toMatchObject({
      isMedicine: false,
      activeIngredient: null,
      strength: null,
      medicineForm: null,
    });
  });
});

describe('Abri: embalagem aberta (D90)', () => {
  it('caixa de comprimidos: 1 caixa vira 10 comprimidos soltos, o total fica igual e o aberto sai primeiro', async () => {
    const prod = await medicine({ name: 'Dipirona 500 mg' });
    const caixas = await lot(prod.id, {
      packages: '2',
      packageName: 'caixa',
      contentText: '10',
      contentUnit: 'un',
      expiryDate: '2027-06-30',
    });
    const account = (await q<{ id: string }>(`select id from bank_accounts limit 1`))[0]!.id;
    const balanceBefore = await getAccountBalance(db, account, HOJE);
    expect((await stockOverview(db, HOJE))[0]!.total).toBe(20);

    const aberto = await open(caixas.id);
    expect(aberto.code).toBe('DIP-02');
    expect(await sqlLotQuantities(prod.id)).toEqual({ 1: 1, 2: 10 });
    const overview = (await stockOverview(db, HOJE))[0]!;
    expect(overview.total).toBe(20); // 1 caixa de 10 + 10 soltos
    const detail = (await lotDetail(db, aberto.id, HOJE))!;
    expect(detail.lot).toMatchObject({
      origin: 'OPENED',
      packageName: 'comprimido',
      contentPerPackage: null,
      entryDate: HOJE,
      expiryDate: '2027-01-04', // hoje + 60 dias, antes da validade da caixa
    });
    expect(detail.sources).toEqual([{ lotId: caixas.id, code: 'DIP-01', packages: 1 }]);
    expect((await lotDetail(db, caixas.id, HOJE))!.repacks).toEqual([
      { lotId: aberto.id, code: 'DIP-02', packages: 1, opened: true },
    ]);

    // o lote aberto vence antes: vem primeiro na ordem de uso, e "Usei" sem lote tira dele
    const { lots } = (await productDetail(db, prod.id, HOJE))!;
    expect(lots.map((l) => l.code)).toEqual(['DIP-02', 'DIP-01']);
    await consumeStock(
      ctx,
      stockUseInput.parse({ productId: prod.id, kind: 'USE', packages: '3', date: HOJE }),
    );
    expect(await sqlLotQuantities(prod.id)).toEqual({ 1: 1, 2: 7 });
    expect((await stockOverview(db, HOJE))[0]!.total).toBe(17);

    // nada disso mexe nas Finanças
    expect(await getAccountBalance(db, account, HOJE)).toEqual(balanceBefore);
    expect(total(await grossSpend(db, '2026-11-01', '2026-11-30', 'category'))).toBe(0);
    expect(total(await monthlySpend(db, '2026-11-01', '2026-11-30', 'category'))).toBe(0);
  });

  it('xarope: o lote aberto é 1 frasco do mesmo volume, com validade curta', async () => {
    const prod = await medicine({
      name: 'Xarope de ambroxol',
      measure: 'VOLUME',
      medicineForm: 'SYRUP',
      openShelfLifeDays: '15',
    });
    const frascos = await lot(prod.id, {
      packages: '2',
      packageName: 'frasco',
      contentText: '120',
      contentUnit: 'ml',
    });
    const aberto = await open(frascos.id);
    const detail = (await lotDetail(db, aberto.id, HOJE))!;
    expect(detail.lot).toMatchObject({
      packageName: 'frasco aberto',
      contentPerPackage: 120,
      expiryDate: '2026-11-20',
    });
    expect(await sqlLotQuantities(prod.id)).toEqual({ 1: 1, 2: 1 });
    expect((await stockOverview(db, HOJE))[0]!.total).toBe(240);
  });

  it('a validade da embalagem fechada vale se vier antes da validade depois de aberto', async () => {
    const prod = await medicine({ name: 'Colírio', measure: 'VOLUME', medicineForm: 'EYE_DROPS' });
    const l = await lot(prod.id, {
      packages: '1',
      packageName: 'frasco',
      contentText: '10',
      contentUnit: 'ml',
      expiryDate: '2026-11-20',
    });
    const aberto = await open(l.id);
    expect((await lotDetail(db, aberto.id, HOJE))!.lot.expiryDate).toBe('2026-11-20');
  });

  it('recusas: sem validade depois de aberto, lote já aberto, sem embalagem fechada, data inválida', async () => {
    const semPrazo = await createStockProduct(
      ctx,
      stockProductInput.parse({ name: 'Água', categoryId: remedios, measure: 'VOLUME' }),
    );
    const agua = await lot(semPrazo.id, {
      packages: '1',
      packageName: 'galão',
      contentText: '5',
      contentUnit: 'L',
    });
    await expect(open(agua.id)).rejects.toThrow('validade depois de aberto');

    const prod = await medicine({ name: 'Ibuprofeno' });
    const caixa = await lot(prod.id, {
      packages: '1',
      packageName: 'caixa',
      contentText: '10',
      contentUnit: 'un',
    });
    await expect(open(caixa.id, '2026-11-06')).rejects.toThrow('futuro');
    await expect(open(caixa.id, '2026-11-04')).rejects.toThrow('antes da entrada');
    const aberto = await open(caixa.id);
    await expect(open(aberto.id)).rejects.toThrow('já está aberto');
    await expect(open(caixa.id)).rejects.toThrow('Sem embalagem fechada');
    // nada ficou pela metade: 1 caixa saiu, 1 lote aberto nasceu
    expect(await sqlLotQuantities(prod.id)).toEqual({ 1: 0, 2: 10 });
  });

  it('desfazer o "Abri" desfaz a operação inteira; recusa se já usou do lote aberto', async () => {
    const prod = await medicine({ name: 'Paracetamol' });
    const caixas = await lot(prod.id, {
      packages: '2',
      packageName: 'caixa',
      contentText: '20',
      contentUnit: 'un',
    });
    const aberto = await open(caixas.id);
    await use(prod.id, aberto.id, 2);

    const moves = (await productDetail(db, prod.id, HOJE))!.movements;
    const openOut = moves.find((m) => m.kind === 'OPEN_OUT')!;
    await expect(cancelStockMovement(ctx, openOut.id)).rejects.toThrow(
      'Parte das embalagens do PAR-02 já saiu',
    );

    await cancelStockMovement(ctx, moves.find((m) => m.kind === 'USE')!.id);
    await cancelStockMovement(ctx, openOut.id); // pela saída da caixa: desfaz a abertura inteira
    expect(await sqlLotQuantities(prod.id)).toEqual({ 1: 2, 2: 0 });
    expect((await stockOverview(db, HOJE))[0]!.total).toBe(40);
    const cancelled = await q<{ kind: string }>(
      `select kind from stock_movements where cancelled_at is not null order by kind`,
    );
    expect(cancelled.map((c) => c.kind).sort()).toEqual(['OPEN_IN', 'OPEN_OUT', 'USE']);
  });

  it('o banco recusa movimento de abertura com direção errada', async () => {
    const prod = await medicine({ name: 'Loratadina' });
    const l = await lot(prod.id, {
      packages: '1',
      packageName: 'caixa',
      contentText: '10',
      contentUnit: 'un',
    });
    await expect(
      q(
        `insert into stock_movements (lot_id, kind, quantity, repack_lot_id, movement_date, created_by_user_id)
         values ($1, 'OPEN_OUT', 1, $1, $2, $3)`,
        [l.id, HOJE, ctx.userId],
      ),
    ).rejects.toThrow();
    await expect(
      q(
        `insert into stock_movements (lot_id, kind, quantity, movement_date, created_by_user_id)
         values ($1, 'OPEN_OUT', -1, $2, $3)`,
        [l.id, HOJE, ctx.userId],
      ),
    ).rejects.toThrow(); // OPEN_OUT sem o lote que nasceu dele
  });
});
