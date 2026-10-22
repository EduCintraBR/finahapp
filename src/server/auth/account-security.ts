/**
 * Segurança da conta, em Ajustes (D64): trocar senha, sair de todos os aparelhos, novos códigos de recuperação
 * e trocar de autenticador. Tudo que é sensível pede a senha atual ou um 2º fator, e grava audit_log.
 */
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AnyDB } from '@/db/client';
import { users } from '@/db/schema';
import { audit } from '../audit';
import { UserError } from '../context';
import {
  confirmEnrollment,
  type Enrollment,
  loadMfaState,
  type MfaDeps,
  replaceRecoveryCodes,
  startEnrollment,
  verifyActiveFactor,
} from './mfa';
import { hashPassword, verifyPassword } from './password';

export const MIN_PASSWORD_LENGTH = 12;

export const changePasswordInput = z
  .object({
    current: z.string().min(1, { error: 'Informe a senha atual.' }).max(200),
    next: z
      .string()
      .min(MIN_PASSWORD_LENGTH, {
        error: `A nova senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`,
      })
      .max(200, { error: 'Senha longa demais.' }),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, {
    error: 'A confirmação não bate com a nova senha.',
    path: ['confirm'],
  })
  .refine((v) => v.next !== v.current, {
    error: 'A nova senha precisa ser diferente da atual.',
    path: ['next'],
  });
export type ChangePasswordInput = z.output<typeof changePasswordInput>;

async function bumpSessionVersion(db: AnyDB, userId: string, reason: string, passwordHash?: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1`, ...(passwordHash ? { passwordHash } : {}) })
      .where(eq(users.id, userId));
    await audit(tx, {
      userId,
      entity: 'users',
      entityId: userId,
      action: 'UPDATE',
      after: { security: reason },
    });
  });
}

/** Troca a senha e derruba todas as sessões (inclusive esta: entra de novo com a senha nova). */
export async function changePassword(db: AnyDB, userId: string, input: ChangePasswordInput) {
  const [u] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!u || !(await verifyPassword(u.hash, input.current))) throw new UserError('Senha atual incorreta.');
  await bumpSessionVersion(db, userId, 'password_changed', await hashPassword(input.next));
}

/** Derruba todas as sessões abertas (celular perdido, aparelho de outra pessoa). */
export async function logoutEverywhere(db: AnyDB, userId: string) {
  await bumpSessionVersion(db, userId, 'logout_everywhere');
}

async function requireFactor(db: AnyDB, userId: string, code: string, deps: MfaDeps) {
  const state = await loadMfaState(db, userId);
  if (!state || !(await verifyActiveFactor(db, state, code.trim(), deps))) {
    throw new UserError('Código inválido ou já usado.');
  }
  return state;
}

/** Novos códigos de recuperação (pede um código do app ou de recuperação); os antigos deixam de valer. */
export async function regenerateRecoveryCodes(db: AnyDB, userId: string, code: string, deps: MfaDeps) {
  await requireFactor(db, userId, code, deps);
  return replaceRecoveryCodes(db, userId);
}

/** Trocar de autenticador, etapa 1: confere o fator atual e prepara o novo (QR). */
export async function startAuthenticatorChange(
  db: AnyDB,
  userId: string,
  code: string,
  deps: MfaDeps,
): Promise<Enrollment> {
  const state = await requireFactor(db, userId, code, deps);
  return startEnrollment(db, state, deps.key, false);
}

/** Trocar de autenticador, etapa 2: o 1º código do app novo confirma a troca. */
export async function confirmAuthenticatorChange(db: AnyDB, userId: string, code: string, deps: MfaDeps) {
  const state = await loadMfaState(db, userId);
  if (!state?.totpPendingSecret) throw new UserError('Comece a troca de novo.');
  if (!(await confirmEnrollment(db, state, code.trim(), deps))) {
    throw new UserError('Código inválido. Confira o app novo e tente de novo.');
  }
}
