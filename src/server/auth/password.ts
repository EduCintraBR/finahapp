import { randomBytes } from 'node:crypto';
import { argon2Verify, argon2id } from 'hash-wasm';

/**
 * argon2id com os parâmetros mínimos recomendados pela OWASP (19 MiB, 2 iterações, paralelismo 1).
 * hash-wasm é WebAssembly puro: sem binário nativo, funciona igual em amd64 e arm64.
 */
const PARAMS = { parallelism: 1, iterations: 2, memorySize: 19_456, hashLength: 32 } as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2id({ ...PARAMS, password, salt: randomBytes(16), outputType: 'encoded' });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify({ hash, password });
  } catch {
    return false; // hash malformado nunca autentica
  }
}

/** Hash fixo para gastar o mesmo tempo quando o email não existe (não revela quais emails existem). */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
