import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AnyDB } from '@/db/client';
import { users } from '@/db/schema';
import {
  confirmEnrollment,
  type Enrollment,
  mfaColumns,
  type MfaDeps,
  startEnrollment,
  verifyActiveFactor,
} from './mfa';
import { getDummyHash, verifyPassword } from './password';
import type { LoginRateLimiter } from './rate-limit';

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().min(1).max(160),
  password: z.string().min(1).max(200),
});

const codeSchema = z.string().trim().min(6).max(20);

export type AuthenticatedUser = { id: string; name: string; email: string; sessionVersion: number };

type Denied = { ok: false; reason: 'invalid' } | { ok: false; reason: 'rate_limited'; retryAfterMs: number };

export type AuthenticateResult = { ok: true; user: AuthenticatedUser } | Denied;

/** Resultado da 1ª etapa (senha): pedir o código, ou cadastrar o autenticador (1º login com 2FA). */
export type BeginLoginResult =
  { ok: true; step: 'code' } | { ok: true; step: 'enroll'; enrollment: Enrollment } | Denied;

type LoginInput = { email: unknown; password: unknown; ip: string };

async function checkPassword(db: AnyDB, limiter: LoginRateLimiter, input: LoginInput) {
  const parsed = credentialsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid' } as const;
  const { email, password } = parsed.data;

  const gate = limiter.check(input.ip, email);
  if (!gate.allowed) return { ok: false, reason: 'rate_limited', retryAfterMs: gate.retryAfterMs } as const;

  const [user] = await db
    .select({
      ...mfaColumns,
      name: users.name,
      passwordHash: users.passwordHash,
      sessionVersion: users.sessionVersion,
    })
    .from(users)
    .where(eq(users.email, email));

  // Sempre roda o argon2, mesmo sem usuário, para não revelar quais emails existem pelo tempo de resposta.
  const valid = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password);
  if (!user || !valid) {
    limiter.recordFailure(input.ip, email);
    return { ok: false, reason: 'invalid' } as const;
  }
  return { ok: true, user, email } as const;
}

/** 1ª etapa do login: confere a senha e diz o que vem depois. Não cria sessão. */
export async function beginLogin(
  db: AnyDB,
  limiter: LoginRateLimiter,
  input: LoginInput,
  key: Buffer,
): Promise<BeginLoginResult> {
  const r = await checkPassword(db, limiter, input);
  if (!r.ok) return r;
  if (r.user.totpEnabledAt) return { ok: true, step: 'code' };
  return { ok: true, step: 'enroll', enrollment: await startEnrollment(db, r.user, key, true) };
}

/**
 * Login completo (o `authorize` do Auth.js): senha + 2º fator. Sem autenticador ativo, o código confirma o
 * autenticador pendente (cadastro). Erro de código conta como tentativa falha no limite de login.
 */
export async function authenticate(
  db: AnyDB,
  limiter: LoginRateLimiter,
  input: LoginInput & { code: unknown },
  deps: MfaDeps,
): Promise<AuthenticateResult> {
  const r = await checkPassword(db, limiter, input);
  if (!r.ok) return r;
  const code = codeSchema.safeParse(input.code);
  const passed =
    code.success &&
    (r.user.totpEnabledAt
      ? await verifyActiveFactor(db, r.user, code.data, deps)
      : await confirmEnrollment(db, r.user, code.data, deps));
  if (!passed) {
    limiter.recordFailure(input.ip, r.email);
    return { ok: false, reason: 'invalid' };
  }
  limiter.recordSuccess(r.email);
  const { id, name, email, sessionVersion } = r.user;
  return { ok: true, user: { id, name, email, sessionVersion } };
}

/**
 * IP do cliente. Atrás do nginx, X-Real-IP é o $remote_addr (o cliente não consegue forjar); sem proxy, o
 * último item do X-Forwarded-For (o primeiro é o que o cliente mandou e serve para burlar o limite).
 */
export function clientIp(headers: Headers): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  return forwarded || 'unknown';
}
