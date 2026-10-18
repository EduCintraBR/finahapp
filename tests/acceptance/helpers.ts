import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/db/schema';

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');

/** PGlite novo com as migrações de drizzle/ aplicadas, e um Drizzle por cima. */
export async function freshDb() {
  const pg = new PGlite();
  for (const f of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    for (const stmt of readFileSync(join(MIGRATIONS_DIR, f), 'utf8').split('--> statement-breakpoint')) {
      await pg.exec(stmt);
    }
  }
  return { pg, db: drizzle(pg, { schema }) };
}
