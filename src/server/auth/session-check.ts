import { eq } from 'drizzle-orm';
import type { AnyDB } from '@/db/client';
import { users } from '@/db/schema';

export type ValidSession = { id: string; name: string; email: string };

/**
 * A sessão ainda vale (D64)? A versão gravada no login precisa ser a atual (não trocou a senha nem saiu de todos
 * os aparelhos depois) e o 2FA precisa estar ativo. Sessão sem versão (de antes do 2FA) não vale.
 */
export async function validSession(
  db: AnyDB,
  userId: string | undefined,
  sessionVersion: number | null | undefined,
): Promise<ValidSession | null> {
  if (!userId || typeof sessionVersion !== 'number') return null;
  const [u] = await db
    .select({ sv: users.sessionVersion, mfa: users.totpEnabledAt, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  if (!u || u.sv !== sessionVersion || !u.mfa) return null;
  return { id: userId, name: u.name, email: u.email };
}
