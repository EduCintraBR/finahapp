/**
 * Segurança da conta em Ajustes (D64): trocar senha e sair de todos os aparelhos derrubam as sessões; novos códigos
 * de recuperação e troca de autenticador pedem um 2º fator. Postgres real (PGlite).
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { seed, seedConfigFromEnv } from '@/db/seed';
import {
  changePassword,
  confirmAuthenticatorChange,
  logoutEverywhere,
  regenerateRecoveryCodes,
  startAuthenticatorChange,
} from '@/server/auth/account-security';
import { authenticate, beginLogin } from '@/server/auth/authenticate';
import { LoginRateLimiter } from '@/server/auth/rate-limit';
import { deriveKey } from '@/server/auth/secret-box';
import { validSession } from '@/server/auth/session-check';
import { totpCode, totpStep } from '@/server/auth/totp';
import { freshDb } from './helpers';

const key = deriveKey('auth-secret-de-teste');
const T0 = 1_800_000_000_000;
const at = (minutes: number) => T0 + minutes * 60_000; // cada etapa num passo de 30 s diferente
const deps = (nowMs: number) => ({ key, nowMs });
const code = (secret: string, nowMs: number) => totpCode(secret, totpStep(nowMs));

let pg: PGlite;
let db: AnyDB;
let userId: string;
let secret: string;
let recovery: string[];

const EMAIL = 'eduardo@example.com';
const PASSWORD = 'senha-do-eduardo';

const login = (password: string, c: string, nowMs: number) =>
  authenticate(db, new LoginRateLimiter(), { email: EMAIL, password, code: c, ip: 'x' }, deps(nowMs));

beforeEach(async () => {
  ({ pg, db } = await freshDb());
  await seed(
    db,
    seedConfigFromEnv({
      SEED_USER1_NAME: 'Eduardo',
      SEED_USER1_EMAIL: EMAIL,
      SEED_USER1_PASSWORD: PASSWORD,
      SEED_USER2_NAME: 'Viviane',
      SEED_USER2_EMAIL: 'viviane@example.com',
      SEED_USER2_PASSWORD: 'senha-da-viviane',
      SEED_OPENING_BALANCE: '0,00',
      SEED_OPENING_BALANCE_DATE: '2026-10-01',
    }),
  );
  userId = (await pg.query<{ id: string }>(`select id from users where email = $1`, [EMAIL])).rows[0]!.id;
  const begin = await beginLogin(
    db,
    new LoginRateLimiter(),
    { email: EMAIL, password: PASSWORD, ip: 'x' },
    key,
  );
  if (!begin.ok || begin.step !== 'enroll') throw new Error('esperava cadastro');
  ({ secret, recoveryCodes: recovery } = begin.enrollment);
  expect((await login(PASSWORD, code(secret, at(0)), at(0))).ok).toBe(true);
});

describe('trocar senha e sair de todos os aparelhos', () => {
  it('troca a senha só com a atual certa e derruba as sessões abertas', async () => {
    await expect(
      changePassword(db, userId, {
        current: 'errada',
        next: 'uma-senha-nova-longa',
        confirm: 'uma-senha-nova-longa',
      }),
    ).rejects.toThrow('Senha atual incorreta');
    expect(await validSession(db, userId, 1)).not.toBeNull();

    await changePassword(db, userId, { current: PASSWORD, next: 'uma-senha-nova-longa', confirm: 'x' });
    expect(await validSession(db, userId, 1)).toBeNull(); // a sessão antiga caiu
    expect((await login(PASSWORD, code(secret, at(1)), at(1))).ok).toBe(false); // senha velha não entra
    const r = await login('uma-senha-nova-longa', code(secret, at(2)), at(2));
    expect(r.ok && r.user.sessionVersion).toBe(2);
  });

  it('sair de todos os aparelhos derruba as sessões sem mudar a senha', async () => {
    await logoutEverywhere(db, userId);
    expect(await validSession(db, userId, 1)).toBeNull();
    expect(await validSession(db, userId, 2)).not.toBeNull();
    const audits = await pg.query(`select after->>'security' s from audit_log where entity = 'users'`);
    expect(audits.rows).toEqual(expect.arrayContaining([{ s: 'logout_everywhere' }]));
  });
});

describe('2FA em Ajustes', () => {
  it('novos códigos de recuperação pedem um 2º fator e invalidam os antigos', async () => {
    await expect(regenerateRecoveryCodes(db, userId, '000000', deps(at(1)))).rejects.toThrow(
      'Código inválido',
    );
    const fresh = await regenerateRecoveryCodes(db, userId, code(secret, at(1)), deps(at(1)));
    expect(fresh).toHaveLength(10);
    expect((await login(PASSWORD, recovery[0]!, at(2))).ok).toBe(false); // antigo não vale
    expect((await login(PASSWORD, fresh[0]!, at(2))).ok).toBe(true);
  });

  it('trocar de autenticador: confere o atual, o 1º código do novo confirma, o antigo deixa de valer', async () => {
    const next = await startAuthenticatorChange(db, userId, code(secret, at(1)), deps(at(1)));
    expect(next.recoveryCodes).toEqual([]); // os códigos de recuperação continuam os mesmos
    // até confirmar, o antigo continua valendo
    expect((await login(PASSWORD, code(secret, at(2)), at(2))).ok).toBe(true);
    await expect(confirmAuthenticatorChange(db, userId, '000000', deps(at(3)))).rejects.toThrow(
      'Código inválido',
    );
    await confirmAuthenticatorChange(db, userId, code(next.secret, at(3)), deps(at(3)));
    expect((await login(PASSWORD, code(secret, at(4)), at(4))).ok).toBe(false);
    expect((await login(PASSWORD, code(next.secret, at(5)), at(5))).ok).toBe(true);
    expect((await login(PASSWORD, recovery[1]!, at(6))).ok).toBe(true); // recuperação mantida
  });

  it('com o celular perdido: um código de recuperação abre a troca de autenticador', async () => {
    const next = await startAuthenticatorChange(db, userId, recovery[2]!, deps(at(1)));
    await confirmAuthenticatorChange(db, userId, code(next.secret, at(2)), deps(at(2)));
    expect((await login(PASSWORD, code(next.secret, at(3)), at(3))).ok).toBe(true);
  });
});
