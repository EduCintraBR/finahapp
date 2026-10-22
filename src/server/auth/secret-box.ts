/**
 * Cifra os segredos do 2FA antes de gravar no banco (AES-256-GCM). Um dump do banco sozinho não revela o
 * segredo do autenticador. A chave é derivada (HKDF) do AUTH_SECRET: trocar o AUTH_SECRET invalida os
 * autenticadores cadastrados (cada um cadastra de novo; ver docs/GUIA.md).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';

export function deriveKey(authSecret: string): Buffer {
  if (!authSecret) throw new Error('AUTH_SECRET não definido: não dá para cifrar o 2FA.');
  return Buffer.from(hkdfSync('sha256', authSecret, 'finah', 'totp-secret-box', 32));
}

export function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

/** null se o texto não for um envelope válido desta chave (adulterado, outra chave, formato antigo). */
export function open(sealed: string, key: Buffer): string | null {
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function appKey(): Buffer {
  return deriveKey(process.env.AUTH_SECRET ?? '');
}
