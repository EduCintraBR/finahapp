import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AnyDB } from '@/db/client';
import { users } from '@/db/schema';
import { getDummyHash, verifyPassword } from './password';
import type { LoginRateLimiter } from './rate-limit';

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(160),
  password: z.string().min(1).max(200),
});

export type AuthenticatedUser = { id: string; name: string; email: string };

export type AuthenticateResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'rate_limited'; retryAfterMs: number };

export async function authenticate(
  db: AnyDB,
  limiter: LoginRateLimiter,
  input: { email: unknown; password: unknown; ip: string },
): Promise<AuthenticateResult> {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  const { email, password } = parsed.data;

  const gate = limiter.check(input.ip, email);
  if (!gate.allowed) return { ok: false, reason: 'rate_limited', retryAfterMs: gate.retryAfterMs };

  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));

  // Sempre roda o argon2, mesmo sem usuário, para não revelar quais emails existem pelo tempo de resposta.
  const valid = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
  if (!user || !valid) {
    limiter.recordFailure(input.ip, email);
    return { ok: false, reason: 'invalid' };
  }

  limiter.recordSuccess(email);
  return { ok: true, user: { id: user.id, name: user.name, email: user.email } };
}

/** IP do cliente atrás do Caddy (primeiro item de X-Forwarded-For). */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip') || 'unknown';
}
