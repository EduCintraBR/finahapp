import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema';

export type Schema = typeof schema;
export type DB = PostgresJsDatabase<Schema>;
/** Qualquer banco Drizzle com o schema do Finah (postgres-js em produção, PGlite nos testes). */
export type AnyDB = PgDatabase<PgQueryResultHKT, Schema>;

export function createDb(url: string, options: postgres.Options<Record<string, never>> = {}) {
  const client = postgres(url, { max: 10, onnotice: () => {}, ...options });
  return { db: drizzle(client, { schema }), client };
}

const globalForDb = globalThis as unknown as { __finahDb?: DB };

/** Conexão única por processo (sobrevive ao HMR do `next dev`). Lazy: o build não precisa de banco. */
export function getDb(): DB {
  if (!globalForDb.__finahDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não definida.');
    globalForDb.__finahDb = createDb(url).db;
  }
  return globalForDb.__finahDb;
}
