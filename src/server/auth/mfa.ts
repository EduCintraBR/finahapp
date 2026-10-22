/**
 * 2FA obrigatório (D64): TOTP de app autenticador + códigos de recuperação de uso único.
 * Os segredos ficam cifrados (secret-box), os códigos de recuperação só como sha256, e cada código de 6 dígitos
 * vale uma vez só (totp_last_step). Toda mudança grava audit_log.
 */
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { AnyDB } from '@/db/client';
import { users } from '@/db/schema';
import { audit } from '../audit';
import { generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode } from './recovery-codes';
import { open, seal } from './secret-box';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

export type MfaState = {
  id: string;
  email: string;
  totpSecret: string | null;
  totpPendingSecret: string | null;
  totpEnabledAt: Date | null;
  totpLastStep: number | null;
  pendingRecoveryCodeHashes: string[];
};

export const mfaColumns = {
  id: users.id,
  email: users.email,
  totpSecret: users.totpSecret,
  totpPendingSecret: users.totpPendingSecret,
  totpEnabledAt: users.totpEnabledAt,
  totpLastStep: users.totpLastStep,
  pendingRecoveryCodeHashes: users.pendingRecoveryCodeHashes,
};

export type Enrollment = { secret: string; otpauthUri: string; recoveryCodes: string[] };

export type MfaDeps = { key: Buffer; nowMs: number };

/**
 * Prepara um autenticador novo (pendente até o 1º código confirmar). `withRecoveryCodes`: no 1º cadastro também
 * gera os códigos de recuperação (que só passam a valer junto com o autenticador).
 */
export async function startEnrollment(
  db: AnyDB,
  user: { id: string; email: string },
  key: Buffer,
  withRecoveryCodes: boolean,
): Promise<Enrollment> {
  const secret = generateTotpSecret();
  const recovery = withRecoveryCodes ? generateRecoveryCodes() : { codes: [], hashes: [] };
  await db
    .update(users)
    .set({ totpPendingSecret: seal(secret, key), pendingRecoveryCodeHashes: recovery.hashes })
    .where(eq(users.id, user.id));
  return { secret, otpauthUri: otpauthUri(secret, user.email), recoveryCodes: recovery.codes };
}

/** Confere o 2º fator de quem já tem autenticador: código do app (sem reuso) ou um código de recuperação. */
export async function verifyActiveFactor(
  db: AnyDB,
  user: MfaState,
  code: string,
  deps: MfaDeps,
): Promise<boolean> {
  if (!user.totpEnabledAt || !user.totpSecret) return false;
  if (looksLikeRecoveryCode(code)) {
    const hash = hashRecoveryCode(code);
    return db.transaction(async (tx) => {
      // remove o código na mesma instrução que confere: dois logins simultâneos não usam o mesmo código
      const used = await tx
        .update(users)
        .set({ recoveryCodeHashes: sql`array_remove(${users.recoveryCodeHashes}, ${hash})` })
        .where(and(eq(users.id, user.id), sql`${hash} = any(${users.recoveryCodeHashes})`))
        .returning({ left: users.recoveryCodeHashes });
      if (used.length === 0) return false;
      await audit(tx, {
        userId: user.id,
        entity: 'users',
        entityId: user.id,
        action: 'UPDATE',
        after: { mfa: 'recovery_code_used', remaining: used[0]!.left.length },
      });
      return true;
    });
  }
  const secret = open(user.totpSecret, deps.key);
  if (!secret) return false;
  const step = verifyTotp(secret, code, deps.nowMs, user.totpLastStep);
  if (step === null) return false;
  const saved = await db
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, user.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
    .returning({ id: users.id });
  return saved.length > 0;
}

/** Confirma o autenticador pendente com o 1º código: ele passa a ser o ativo. */
export async function confirmEnrollment(
  db: AnyDB,
  user: MfaState,
  code: string,
  deps: MfaDeps,
): Promise<boolean> {
  if (!user.totpPendingSecret) return false;
  const secret = open(user.totpPendingSecret, deps.key);
  if (!secret) return false;
  const step = verifyTotp(secret, code, deps.nowMs);
  if (step === null) return false;
  const firstTime = !user.totpEnabledAt;
  return db.transaction(async (tx) => {
    const done = await tx
      .update(users)
      .set({
        totpSecret: user.totpPendingSecret,
        totpPendingSecret: null,
        totpEnabledAt: new Date(deps.nowMs),
        totpLastStep: step,
        // trocar de autenticador mantém os códigos de recuperação; o 1º cadastro ativa os gerados com ele
        ...(user.pendingRecoveryCodeHashes.length > 0
          ? { recoveryCodeHashes: user.pendingRecoveryCodeHashes, pendingRecoveryCodeHashes: [] }
          : {}),
      })
      .where(and(eq(users.id, user.id), eq(users.totpPendingSecret, user.totpPendingSecret!)))
      .returning({ id: users.id });
    if (done.length === 0) return false;
    await audit(tx, {
      userId: user.id,
      entity: 'users',
      entityId: user.id,
      action: 'UPDATE',
      after: { mfa: firstTime ? 'enabled' : 'authenticator_changed' },
    });
    return true;
  });
}

export async function loadMfaState(db: AnyDB, userId: string): Promise<MfaState | null> {
  const [u] = await db.select(mfaColumns).from(users).where(eq(users.id, userId));
  return u ?? null;
}

/** Novos códigos de recuperação (os antigos deixam de valer). */
export async function replaceRecoveryCodes(db: AnyDB, userId: string): Promise<string[]> {
  const { codes, hashes } = generateRecoveryCodes();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ recoveryCodeHashes: hashes }).where(eq(users.id, userId));
    await audit(tx, {
      userId,
      entity: 'users',
      entityId: userId,
      action: 'UPDATE',
      after: { mfa: 'recovery_codes_regenerated' },
    });
  });
  return codes;
}
