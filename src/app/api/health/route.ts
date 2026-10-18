import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';

export const dynamic = 'force-dynamic';

/** Healthcheck do container: app no ar e banco respondendo. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: 'Banco indisponível.' }, { status: 503 });
  }
}
