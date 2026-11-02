import { sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { categories } from '../schema';

/**
 * Rótulo da categoria de um lançamento (D74): "Mercado › Hortifruti" para subcategoria, só o nome para categoria de topo.
 * Use junto de `.leftJoin(parentCategory, eq(parentCategory.id, categories.parentId))`; o ícone da subcategoria cai no da mãe.
 */
export const parentCategory = alias(categories, 'parent_category');

export const categoryLabelSql = sql<
  string | null
>`case when ${parentCategory.name} is not null then ${parentCategory.name} || ' › ' || ${categories.name} else ${categories.name} end`;

export const categoryIconSql = sql<string | null>`coalesce(${categories.icon}, ${parentCategory.icon})`;
