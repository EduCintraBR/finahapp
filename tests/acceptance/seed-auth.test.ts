/**
 * Seed + login contra Postgres real (PGlite com as migrações do drizzle-kit).
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { seedCategories } from '@/db/seed-data';
import { authenticate } from '@/server/auth/authenticate';
import { LoginRateLimiter } from '@/server/auth/rate-limit';
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

describe('login', () => {
  it('autentica com email em qualquer caixa e rejeita senha errada', async () => {
    await seed(db, seedConfigFromEnv(env));
    const limiter = new LoginRateLimiter();
    const ok = await authenticate(db, limiter, {
      email: ' EDUARDO@example.com ',
      password: 'senha-do-eduardo',
      ip: 'x',
    });
    expect(ok.ok && ok.user.name).toBe('Eduardo');
    expect(
      await authenticate(db, limiter, { email: 'eduardo@example.com', password: 'errada', ip: 'x' }),
    ).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(await authenticate(db, limiter, { email: 'ninguem@example.com', password: 'x', ip: 'x' })).toEqual(
      {
        ok: false,
        reason: 'invalid',
      },
    );
    expect(await authenticate(db, limiter, { email: 42, password: null, ip: 'x' })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('bloqueia após 5 senhas erradas, mesmo com a senha certa', async () => {
    await seed(db, seedConfigFromEnv(env));
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < 5; i++) {
      await authenticate(db, limiter, {
        email: 'esposa@example.com',
        password: `errada${i}`,
        ip: '10.0.0.1',
      });
    }
    const r = await authenticate(db, limiter, {
      email: 'esposa@example.com',
      password: 'senha-da-esposa',
      ip: '10.0.0.1',
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('rate_limited');
    // o outro usuário, no mesmo IP, continua entrando
    const other = await authenticate(db, limiter, {
      email: 'eduardo@example.com',
      password: 'senha-do-eduardo',
      ip: '10.0.0.1',
    });
    expect(other.ok).toBe(true);
  });
});
