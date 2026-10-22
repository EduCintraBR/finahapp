/**
 * Códigos de recuperação do 2FA: 10 códigos de uso único ("abcd-efgh", 40 bits cada) para entrar sem o
 * celular. Só o sha256 fica no banco (o código tem entropia alta, não precisa de argon2); o texto puro aparece
 * uma única vez, na hora de gerar.
 */
import { createHash, randomBytes } from 'node:crypto';
import { base32Encode } from './totp';

export const RECOVERY_CODE_COUNT = 10;

export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z2-7]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: count }, () => {
    const raw = base32Encode(randomBytes(5)).toLowerCase(); // 8 caracteres
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/** Parece código de recuperação (8 letras/dígitos base32), e não código de 6 dígitos do app. */
export function looksLikeRecoveryCode(code: string): boolean {
  return normalizeRecoveryCode(code).length === 8;
}
