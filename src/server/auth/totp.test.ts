import { describe, expect, it } from 'vitest';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
} from './recovery-codes';
import { deriveKey, open, seal } from './secret-box';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUri,
  totpCode,
  totpStep,
  verifyTotp,
} from './totp';

// Vetores da RFC 6238 (SHA1, segredo ASCII "12345678901234567890"), truncados para 6 dígitos.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));
const RFC_VECTORS: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
];

describe('TOTP (RFC 6238)', () => {
  it.each(RFC_VECTORS)('t=%i → %s', (seconds, code) => {
    expect(totpCode(RFC_SECRET, totpStep(seconds * 1000))).toBe(code);
  });

  it('base32 ida e volta', () => {
    const buf = Buffer.from('qualquer coisa ç', 'utf8');
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('aceita o passo atual e os vizinhos (relógio fora de hora), recusa mais longe', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), now)).toBeNull();
  });

  it('não aceita reuso: código de um passo já usado (ou anterior) é recusado', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    const code = totpCode(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now, step)).toBe(step + 1);
  });

  it('recusa formato errado', () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '', now)).toBeNull();
  });

  it('otpauth URI com emissor e conta', () => {
    const uri = otpauthUri('ABC', 'eduardo@exemplo.com');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Finah%3Aeduardo%40exemplo\.com\?/);
    expect(uri).toContain('secret=ABC');
    expect(uri).toContain('issuer=Finah');
  });
});

describe('cifra do segredo (AES-256-GCM)', () => {
  const key = deriveKey('um-auth-secret-de-teste');

  it('abre o que selou; outra chave ou texto adulterado não abre', () => {
    const sealed = seal('SEGREDO', key);
    expect(sealed.startsWith('v1:')).toBe(true);
    expect(sealed).not.toContain('SEGREDO');
    expect(open(sealed, key)).toBe('SEGREDO');
    expect(open(sealed, deriveKey('outro-secret'))).toBeNull();
    const parts = sealed.split(':');
    const tampered = [...parts.slice(0, 3), Buffer.from('xxxx').toString('base64')].join(':');
    expect(open(tampered, key)).toBeNull();
    expect(open('lixo', key)).toBeNull();
  });

  it('cada selagem usa IV novo', () => {
    expect(seal('x', key)).not.toBe(seal('x', key));
  });
});

describe('códigos de recuperação', () => {
  it('gera 10 códigos únicos no formato abcd-efgh, e só os hashes', () => {
    const { codes, hashes } = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}$/);
    expect(hashes).toEqual(codes.map(hashRecoveryCode));
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normaliza maiúsculas, espaços e traço', () => {
    expect(hashRecoveryCode(' ABCD efgh ')).toBe(hashRecoveryCode('abcd-efgh'));
    expect(normalizeRecoveryCode('AB-CD')).toBe('abcd');
    expect(looksLikeRecoveryCode('abcd-efgh')).toBe(true);
    expect(looksLikeRecoveryCode('123456')).toBe(false);
  });
});
