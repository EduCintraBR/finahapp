/**
 * TOTP (RFC 6238, o mesmo do Google Authenticator / 1Password / Authy): HMAC-SHA1, 6 dígitos, passos de 30 s.
 * Feito com o `crypto` do Node, sem dependência. O relógio é injetável (`nowMs`) para os testes.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STEP_SECONDS = 30;
const DIGITS = 6;
/** Aceita o passo anterior e o seguinte (relógio do celular um pouco adiantado/atrasado). */
const WINDOW = 1;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('Segredo TOTP inválido.');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Segredo novo: 20 bytes aleatórios (160 bits, o recomendado pela RFC 4226), em base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/** Código de 6 dígitos de um passo (HOTP com contador = passo). */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Confere um código. Devolve o passo que bateu (para gravar e impedir reuso) ou null.
 * `lastStep`: último passo já aceito; um código desse passo ou anterior é recusado (não dá para reaproveitar
 * um código visto por alguém por cima do ombro).
 */
export function verifyTotp(
  secret: string,
  code: string,
  nowMs: number,
  lastStep: number | null = null,
): number | null {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const current = totpStep(nowMs);
  for (let delta = -WINDOW; delta <= WINDOW; delta++) {
    const step = current + delta;
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(totpCode(secret, step));
    if (timingSafeEqual(expected, Buffer.from(digits))) return step;
  }
  return null;
}

/** URI que o app autenticador lê pelo QR code. */
export function otpauthUri(secret: string, accountEmail: string, issuer = 'Finah'): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
