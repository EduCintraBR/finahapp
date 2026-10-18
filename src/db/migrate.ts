/**
 * Aplica as migrações de `drizzle/` (as mesmas que o teste de aceitação usa).
 * Dev: `pnpm db:migrate`. Docker: serviço one-shot `migrate` (`node dist/migrate.mjs`).
 */
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[migrate] DATABASE_URL não definida.');
  process.exit(1);
}

const { db, client } = createDb(url, { max: 1 });
try {
  await migrate(db, { migrationsFolder: process.env.MIGRATIONS_DIR ?? 'drizzle' });
  console.log('[migrate] migrações aplicadas.');
} catch (err) {
  console.error('[migrate] falhou:', err);
  process.exitCode = 1;
} finally {
  await client.end();
}
