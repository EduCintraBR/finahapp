/**
 * Leituras do estoque da Casa (D81 a D83). A quantidade de cada lote é Σ movimentos não cancelados, numa agregação
 * agrupada (sem subconsulta correlacionada); o resto (totais, FEFO, validade) sai das regras puras de domain/stock.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { lotCode } from '@/domain/stock/catalog';
import type { Measure } from '@/domain/stock/measure';
import {
  expiryLevel,
  sortFefo,
  totalInMeasure,
  type ExpiryLevel,
  type MovementKind,
} from '@/domain/stock/quantity';
import type { ISODate } from '@/domain/dates';
import type { AnyDB } from '../client';
import { stockCategories, stockLocations, stockLots, stockMovements, stockProducts, users } from '../schema';

/** Ordem alfabética do português (o Postgres com collation C poria "Água" depois de "Remédios"). */
const byName = <T extends { name: string }>(rows: T[]): T[] =>
  rows.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

export type StockCategoryRow = {
  id: string;
  name: string;
  parentId: string | null;
  icon: string | null;
  archivedAt: Date | null;
};

export async function listStockCategories(
  db: AnyDB,
  opts: { includeArchived?: boolean } = {},
): Promise<StockCategoryRow[]> {
  const rows = await db
    .select({
      id: stockCategories.id,
      name: stockCategories.name,
      parentId: stockCategories.parentId,
      icon: stockCategories.icon,
      archivedAt: stockCategories.archivedAt,
    })
    .from(stockCategories)
    .where(opts.includeArchived ? undefined : isNull(stockCategories.archivedAt));
  return byName(rows);
}

export type StockLocationRow = { id: string; name: string; archivedAt: Date | null };

export async function listStockLocations(
  db: AnyDB,
  opts: { includeArchived?: boolean } = {},
): Promise<StockLocationRow[]> {
  const rows = await db
    .select({ id: stockLocations.id, name: stockLocations.name, archivedAt: stockLocations.archivedAt })
    .from(stockLocations)
    .where(opts.includeArchived ? undefined : isNull(stockLocations.archivedAt));
  return byName(rows);
}

export type ProductRow = {
  id: string;
  name: string;
  prefix: string;
  measure: Measure;
  categoryId: string;
  categoryName: string;
  /** categoria de topo (a própria, ou a mãe quando o produto está numa subcategoria) */
  topCategoryId: string;
  /** "Alimentos › Grãos" ou "Água" */
  categoryLabel: string;
  defaultLocationId: string | null;
  defaultLocationName: string | null;
  minQuantity: number | null;
  targetQuantity: number | null;
  defaultPackage: string | null;
  defaultContent: number | null;
  notes: string | null;
  archivedAt: Date | null;
};

async function productRows(
  db: AnyDB,
  where: { id?: string; includeArchived?: boolean },
): Promise<ProductRow[]> {
  const [rows, cats] = await Promise.all([
    db
      .select({
        id: stockProducts.id,
        name: stockProducts.name,
        prefix: stockProducts.prefix,
        measure: stockProducts.measure,
        categoryId: stockProducts.categoryId,
        defaultLocationId: stockProducts.defaultLocationId,
        defaultLocationName: stockLocations.name,
        minQuantity: stockProducts.minQuantity,
        targetQuantity: stockProducts.targetQuantity,
        defaultPackage: stockProducts.defaultPackage,
        defaultContent: stockProducts.defaultContent,
        notes: stockProducts.notes,
        archivedAt: stockProducts.archivedAt,
      })
      .from(stockProducts)
      .leftJoin(stockLocations, eq(stockLocations.id, stockProducts.defaultLocationId))
      .where(
        and(
          where.id ? eq(stockProducts.id, where.id) : undefined,
          where.includeArchived || where.id ? undefined : isNull(stockProducts.archivedAt),
        ),
      ),
    listStockCategories(db, { includeArchived: true }),
  ]);
  const byId = new Map(cats.map((c) => [c.id, c]));
  return byName(rows).map((r) => {
    const cat = byId.get(r.categoryId);
    const parent = cat?.parentId ? byId.get(cat.parentId) : undefined;
    return {
      ...r,
      categoryName: cat?.name ?? '',
      topCategoryId: parent?.id ?? r.categoryId,
      categoryLabel: parent ? `${parent.name} › ${cat!.name}` : (cat?.name ?? ''),
    };
  });
}

export type LotRow = {
  id: string;
  productId: string;
  number: number;
  code: string;
  locationId: string | null;
  locationName: string | null;
  packageName: string;
  contentPerPackage: number | null;
  entryDate: ISODate;
  expiryDate: ISODate | null;
  origin: 'PURCHASE' | 'REPACK';
  notes: string | null;
  /** embalagens: Σ movimentos não cancelados */
  quantity: number;
};

const toInt = (v: string | number | null | undefined) => {
  const n = Number(v ?? 0);
  if (!Number.isSafeInteger(n)) throw new Error(`Quantidade inválida vinda do banco: ${v}`);
  return n;
};

/** Lotes (de um produto, ou de todos os produtos ativos) com a quantidade de cada um. */
export async function listLots(db: AnyDB, productIds?: string[]): Promise<LotRow[]> {
  if (productIds && productIds.length === 0) return [];
  const sums = db
    .select({
      lotId: stockMovements.lotId,
      quantity: sql<string>`sum(${stockMovements.quantity})`.as('quantity'),
    })
    .from(stockMovements)
    .where(isNull(stockMovements.cancelledAt))
    .groupBy(stockMovements.lotId)
    .as('lot_sums');
  const rows = await db
    .select({
      id: stockLots.id,
      productId: stockLots.productId,
      number: stockLots.number,
      prefix: stockProducts.prefix,
      locationId: stockLots.locationId,
      locationName: stockLocations.name,
      packageName: stockLots.packageName,
      contentPerPackage: stockLots.contentPerPackage,
      entryDate: stockLots.entryDate,
      expiryDate: stockLots.expiryDate,
      origin: stockLots.origin,
      notes: stockLots.notes,
      quantity: sums.quantity,
    })
    .from(stockLots)
    .innerJoin(stockProducts, eq(stockProducts.id, stockLots.productId))
    .leftJoin(stockLocations, eq(stockLocations.id, stockLots.locationId))
    .leftJoin(sums, eq(sums.lotId, stockLots.id))
    .where(productIds ? inArray(stockLots.productId, productIds) : isNull(stockProducts.archivedAt))
    .orderBy(asc(stockLots.number));
  return rows.map(({ prefix, quantity, ...r }) => ({
    ...r,
    code: lotCode(prefix, r.number),
    quantity: toInt(quantity),
  }));
}

export type ProductSummary = ProductRow & {
  /** embalagens em estoque (Σ lotes) */
  packages: number;
  /** total na medida do produto (un, g ou ml) */
  total: number;
  lotsInStock: number;
  /** nomes das embalagens em estoque ("pacote", "garrafa PET") */
  packageNames: string[];
  /** locais dos lotes em estoque (ou o local padrão, sem estoque) */
  locationNames: string[];
  nextExpiry: ISODate | null;
  expiry: ExpiryLevel | null;
  /** abaixo do estoque mínimo (sem mínimo = false) */
  low: boolean;
};

function summarize(product: ProductRow, lots: LotRow[], today: ISODate): ProductSummary {
  const inStock = sortFefo(lots.filter((l) => l.quantity > 0));
  const total = totalInMeasure(inStock);
  const nextExpiry = inStock.find((l) => l.expiryDate)?.expiryDate ?? null;
  const unique = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  const locations = unique(inStock.map((l) => l.locationName));
  return {
    ...product,
    packages: inStock.reduce((s, l) => s + l.quantity, 0),
    total,
    lotsInStock: inStock.length,
    packageNames: unique(inStock.map((l) => l.packageName)),
    locationNames: locations.length > 0 ? locations : unique([product.defaultLocationName]),
    nextExpiry,
    expiry: expiryLevel(nextExpiry, today),
    low: product.minQuantity !== null && total < product.minQuantity,
  };
}

/** Todos os produtos ativos com quantidade, locais e próxima validade (a casa tem centenas, não milhões). */
export async function stockOverview(db: AnyDB, today: ISODate): Promise<ProductSummary[]> {
  const [products, lots] = await Promise.all([productRows(db, {}), listLots(db)]);
  const byProduct = new Map<string, LotRow[]>();
  for (const l of lots) byProduct.set(l.productId, [...(byProduct.get(l.productId) ?? []), l]);
  return products.map((p) => summarize(p, byProduct.get(p.id) ?? [], today));
}

export type MovementRow = {
  id: string;
  lotId: string;
  lotCode: string;
  kind: MovementKind;
  quantity: number;
  movementDate: ISODate;
  notes: string | null;
  userName: string;
  createdAt: Date;
  cancelledAt: Date | null;
};

async function movementRows(db: AnyDB, opts: { productId?: string; limit: number }): Promise<MovementRow[]> {
  const rows = await db
    .select({
      id: stockMovements.id,
      lotId: stockMovements.lotId,
      number: stockLots.number,
      prefix: stockProducts.prefix,
      kind: stockMovements.kind,
      quantity: stockMovements.quantity,
      movementDate: stockMovements.movementDate,
      notes: stockMovements.notes,
      userName: users.name,
      createdAt: stockMovements.createdAt,
      cancelledAt: stockMovements.cancelledAt,
    })
    .from(stockMovements)
    .innerJoin(stockLots, eq(stockLots.id, stockMovements.lotId))
    .innerJoin(stockProducts, eq(stockProducts.id, stockLots.productId))
    .innerJoin(users, eq(users.id, stockMovements.createdByUserId))
    .where(opts.productId ? eq(stockLots.productId, opts.productId) : undefined)
    .orderBy(desc(stockMovements.createdAt))
    .limit(opts.limit);
  return rows.map(({ number, prefix, ...r }) => ({ ...r, lotCode: lotCode(prefix, number) }));
}

export type ProductDetail = {
  product: ProductSummary;
  /** em estoque na ordem de uso (FEFO), depois os zerados (mais recentes primeiro) */
  lots: LotRow[];
  movements: MovementRow[];
};

export async function productDetail(db: AnyDB, id: string, today: ISODate): Promise<ProductDetail | null> {
  const [product] = await productRows(db, { id });
  if (!product) return null;
  const [lots, movements] = await Promise.all([
    listLots(db, [id]),
    movementRows(db, { productId: id, limit: 50 }),
  ]);
  const inStock = sortFefo(lots.filter((l) => l.quantity > 0));
  const empty = lots.filter((l) => l.quantity <= 0).sort((a, b) => b.number - a.number);
  return { product: summarize(product, lots, today), lots: [...inStock, ...empty], movements };
}

export type RecentMovement = MovementRow & { productId: string; productName: string; packageName: string };

/** Últimos movimentos da casa toda (Início da Casa). */
export async function recentMovements(db: AnyDB, limit = 6): Promise<RecentMovement[]> {
  const rows = await movementRows(db, { limit });
  if (rows.length === 0) return [];
  const lots = await db
    .select({
      id: stockLots.id,
      productId: stockLots.productId,
      productName: stockProducts.name,
      packageName: stockLots.packageName,
    })
    .from(stockLots)
    .innerJoin(stockProducts, eq(stockProducts.id, stockLots.productId))
    .where(inArray(stockLots.id, [...new Set(rows.map((r) => r.lotId))]));
  const byLot = new Map(lots.map((l) => [l.id, l]));
  return rows.map((r) => {
    const l = byLot.get(r.lotId)!;
    return { ...r, productId: l.productId, productName: l.productName, packageName: l.packageName };
  });
}
