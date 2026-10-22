/**
 * Seed + login contra Postgres real (PGlite com as migrações do drizzle-kit).
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { seedCategories } from '@/db/seed-data';
import { authenticate, beginLogin } from '@/server/auth/authenticate';
import { LoginRateLimiter } from '@/server/auth/rate-limit';
import { deriveKey } from '@/server/auth/secret-box';
import { validSession } from '@/server/auth/session-check';
import { totpCode, totpStep } from '@/server/auth/totp';
import { freshDb } from './helpers';

const env = {
  SEED_USER1_NAME: 'Eduardo',
  SEED_USER1_EMAIL: 'Eduardo@Example.com',
  SEED_USER1_PASSWORD: 'senha-do-eduardo',
  SEED_USER1_TELEGRAM_ID: '123456',
  SEED_USER2_NAME: 'Esposa',
  SEED_USER2_EMAIL: 'esposa@example.com',
  SEED_USER2_PASSWORD: 'senha-da-esposa',
  SEED_OPENING_BALANCE: '5.000,00',
  SEED_OPENING_BALANCE_DATE: '2026-10-01',
};

let pg: PGlite;
let db: AnyDB;
const count = async (table: string) =>
  (await pg.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0]!.n;

beforeEach(async () => {
  ({ pg, db } = await freshDb());
});

describe('seed', () => {
  it('cria 2 usuários, todas as categorias e a conta principal com saldo inicial', async () => {
    const report = await seed(db, seedConfigFromEnv(env));
    expect(report).toEqual({ usersCreated: 2, usersUpdated: 0, categoriesCreated: 22, accountCreated: true });

    expect(await count('users')).toBe(2);
    expect(await count('categories')).toBe(seedCategories.EXPENSE.length + seedCategories.INCOME.length);
    const acc = (
      await pg.query<{
        name: string;
        opening_balance_cents: string;
        opening_balance_date: string;
        is_primary: boolean;
      }>(
        `select name, opening_balance_cents::text, opening_balance_date::text, is_primary from bank_accounts`,
      )
    ).rows;
    expect(acc).toEqual([
      {
        name: 'Conta principal',
        opening_balance_cents: '500000',
        opening_balance_date: '2026-10-01',
        is_primary: true,
      },
    ]);
    const u = (
      await pg.query<{ email: string; telegram_user_id: string | null }>(
        `select email, telegram_user_id::text from users order by email`,
      )
    ).rows;
    expect(u).toEqual([
      { email: 'eduardo@example.com', telegram_user_id: '123456' },
      { email: 'esposa@example.com', telegram_user_id: null },
    ]);
    expect(await count(`audit_log where entity = 'bank_accounts'`)).toBe(1);
    // senha nunca vai para o audit_log
    const audit = (await pg.query<{ after: unknown }>(`select after from audit_log`)).rows;
    expect(JSON.stringify(audit)).not.toContain('senha');
  });

  it('é idempotente e nunca altera o saldo inicial existente', async () => {
    await seed(db, seedConfigFromEnv(env));
    const report = await seed(db, seedConfigFromEnv({ ...env, SEED_OPENING_BALANCE: '9.999,99' }));
    expect(report).toEqual({ usersCreated: 0, usersUpdated: 2, categoriesCreated: 0, accountCreated: false });
    expect(await count('users')).toBe(2);
    expect(await count('categories')).toBe(22);
    expect(await count('bank_accounts')).toBe(1);
    const bal = (await pg.query<{ v: string }>(`select opening_balance_cents::text v from bank_accounts`))
      .rows[0]!.v;
    expect(bal).toBe('500000');
  });

  it('não cria um 3º usuário se o email mudar no .env (rollback completo)', async () => {
    await seed(db, seedConfigFromEnv(env));
    await expect(
      seed(db, seedConfigFromEnv({ ...env, SEED_USER2_EMAIL: 'outra@example.com' })),
    ).rejects.toThrow('Esperava 2 usuários');
    expect(await count('users')).toBe(2);
  });

  it('valida o .env com mensagens em pt-BR', () => {
    expect(() => seedConfigFromEnv({ ...env, SEED_OPENING_BALANCE: '12,345' })).toThrow(
      'SEED_OPENING_BALANCE',
    );
    expect(() => seedConfigFromEnv({ ...env, SEED_OPENING_BALANCE_DATE: '2026-02-30' })).toThrow(
      'AAAA-MM-DD',
    );
    expect(() => seedConfigFromEnv({ ...env, SEED_USER2_PASSWORD: 'curta' })).toThrow(
      'pelo menos 10 caracteres',
    );
    expect(() => seedConfigFromEnv({ ...env, SEED_USER2_EMAIL: env.SEED_USER1_EMAIL.toLowerCase() })).toThrow(
      'emails diferentes',
    );
    expect(seedConfigFromEnv({ ...env, SEED_OPENING_BALANCE: '-150,25' }).account.openingBalance).toBe(
      -15025,
    );
  });
});

describe('login com 2FA obrigatório (D64)', () => {
  const key = deriveKey('auth-secret-de-teste');
  const NOW = 1_800_000_000_000;
  const deps = (nowMs = NOW) => ({ key, nowMs });
  const codeAt = (secret: string, nowMs = NOW) => totpCode(secret, totpStep(nowMs));
  const user = async (email: string) =>
    (
      await pg.query<{
        totp_secret: string | null;
        totp_pending_secret: string | null;
        totp_enabled_at: Date | null;
        recovery: number;
      }>(
        `select totp_secret, totp_pending_secret, totp_enabled_at, cardinality(recovery_code_hashes) recovery from users where email = $1`,
        [email],
      )
    ).rows[0]!;
  const auth = (
    email: string,
    password: string,
    code: string,
    nowMs = NOW,
    limiter = new LoginRateLimiter(),
  ) => authenticate(db, limiter, { email, password, code, ip: 'x' }, deps(nowMs));

  /** 1º login: senha → cadastro do autenticador → código confirma. Devolve o segredo e os códigos de recuperação. */
  const enroll = async (limiter: LoginRateLimiter, email: string, password: string) => {
    const begin = await beginLogin(db, limiter, { email, password, ip: 'x' }, key);
    if (!begin.ok || begin.step !== 'enroll') throw new Error('esperava cadastro');
    const r = await auth(email, password, codeAt(begin.enrollment.secret), NOW, limiter);
    expect(r.ok).toBe(true);
    return begin.enrollment;
  };

  it('senha errada não passa da 1ª etapa; email em qualquer caixa; sem código não entra', async () => {
    await seed(db, seedConfigFromEnv(env));
    const limiter = new LoginRateLimiter();
    const begin = (email: unknown, password: unknown) =>
      beginLogin(db, limiter, { email, password, ip: 'x' }, key);
    const invalid = { ok: false, reason: 'invalid' };
    expect(await begin('eduardo@example.com', 'errada')).toEqual(invalid);
    expect(await begin('ninguem@example.com', 'x')).toEqual(invalid);
    expect(await begin(42, null)).toEqual(invalid);
    const r = await begin(' EDUARDO@example.com ', 'senha-do-eduardo');
    expect(r.ok && r.step).toBe('enroll');
    // senha certa sem código (o authorize sozinho) não cria sessão
    expect(await auth('eduardo@example.com', 'senha-do-eduardo', '')).toEqual(invalid);
  });

  it('1º login cadastra o autenticador: segredo cifrado, 10 códigos, e depois pede só o código (sem reuso)', async () => {
    await seed(db, seedConfigFromEnv(env));
    const limiter = new LoginRateLimiter();
    const { secret, recoveryCodes, otpauthUri } = await enroll(
      limiter,
      'eduardo@example.com',
      'senha-do-eduardo',
    );
    expect(recoveryCodes).toHaveLength(10);
    expect(otpauthUri).toContain('otpauth://totp/Finah');

    const u = await user('eduardo@example.com');
    expect(u.totp_enabled_at).not.toBeNull();
    expect(u.totp_pending_secret).toBeNull();
    expect(u.recovery).toBe(10);
    expect(u.totp_secret).toMatch(/^v1:/);
    expect(u.totp_secret).not.toContain(secret); // nunca em texto puro

    expect(
      await beginLogin(
        db,
        limiter,
        { email: 'eduardo@example.com', password: 'senha-do-eduardo', ip: 'x' },
        key,
      ),
    ).toEqual({ ok: true, step: 'code' });

    // o mesmo código (mesmo passo de 30 s) não vale de novo; o do passo seguinte vale
    expect((await auth('eduardo@example.com', 'senha-do-eduardo', codeAt(secret))).ok).toBe(false);
    const later = NOW + 30_000;
    expect(await auth('eduardo@example.com', 'senha-do-eduardo', codeAt(secret, later), later)).toEqual({
      ok: true,
      user: expect.objectContaining({ name: 'Eduardo', email: 'eduardo@example.com', sessionVersion: 1 }),
    });
    // código errado; senha errada com código certo
    const after = later + 60_000;
    expect((await auth('eduardo@example.com', 'senha-do-eduardo', '000000', after)).ok).toBe(false);
    expect((await auth('eduardo@example.com', 'errada', codeAt(secret, after), after)).ok).toBe(false);
  });

  it('código de recuperação entra uma vez só e é gasto', async () => {
    await seed(db, seedConfigFromEnv(env));
    const { recoveryCodes } = await enroll(new LoginRateLimiter(), 'esposa@example.com', 'senha-da-esposa');
    expect((await auth('esposa@example.com', 'senha-da-esposa', recoveryCodes[3]!.toUpperCase())).ok).toBe(
      true,
    );
    expect((await user('esposa@example.com')).recovery).toBe(9);
    expect((await auth('esposa@example.com', 'senha-da-esposa', recoveryCodes[3]!)).ok).toBe(false);
    const audits = await pg.query(
      `select 1 from audit_log where entity = 'users' and after->>'mfa' = 'recovery_code_used'`,
    );
    expect(audits.rows).toHaveLength(1);
  });

  it('bloqueia após 5 erros de código, mesmo com tudo certo; o outro usuário no mesmo IP entra', async () => {
    await seed(db, seedConfigFromEnv(env));
    const limiter = new LoginRateLimiter();
    const esposa = await enroll(limiter, 'esposa@example.com', 'senha-da-esposa');
    const eduardo = await enroll(limiter, 'eduardo@example.com', 'senha-do-eduardo');
    const later = NOW + 90_000;
    const tryLogin = (email: string, password: string, code: string) =>
      authenticate(db, limiter, { email, password, code, ip: '10.0.0.1' }, deps(later));
    for (let i = 0; i < 5; i++) await tryLogin('esposa@example.com', 'senha-da-esposa', `00000${i}`);
    const r = await tryLogin('esposa@example.com', 'senha-da-esposa', codeAt(esposa.secret, later));
    expect(!r.ok && r.reason).toBe('rate_limited');
    const other = await tryLogin('eduardo@example.com', 'senha-do-eduardo', codeAt(eduardo.secret, later));
    expect(other.ok).toBe(true);
  });

  it('sessão só vale com a versão atual e o 2FA ativo', async () => {
    await seed(db, seedConfigFromEnv(env));
    const id = (await pg.query<{ id: string }>(`select id from users where email = 'eduardo@example.com'`))
      .rows[0]!.id;
    expect(await validSession(db, id, 1)).toBeNull(); // sem 2FA ainda
    await enroll(new LoginRateLimiter(), 'eduardo@example.com', 'senha-do-eduardo');
    expect(await validSession(db, id, 1)).toEqual(expect.objectContaining({ id, name: 'Eduardo' }));
    expect(await validSession(db, id, null)).toBeNull(); // sessão de antes do 2FA (sem versão)
    await pg.query(`update users set session_version = session_version + 1 where id = $1`, [id]);
    expect(await validSession(db, id, 1)).toBeNull(); // trocou a senha / saiu de todos os aparelhos
    expect(await validSession(db, id, 2)).not.toBeNull();
  });
});
