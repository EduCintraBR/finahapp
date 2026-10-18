/**
 * Seed idempotente: 2 usuários (do .env), categorias (seed-data.ts) e a conta principal.
 * Pode rodar quantas vezes quiser:
 *  - usuários: upsert por email (nome, cor, Telegram e senha voltam a ser os do .env);
 *  - categorias: só insere as que faltam (edições feitas no app são preservadas);
 *  - conta principal: criada uma única vez. O saldo inicial NUNCA é alterado por um novo seed,
 *    porque mudaria o saldo derivado de todo o histórico.
 *
 * Dev: `pnpm db:seed`. Docker: `docker compose run --rm app node dist/seed.mjs`.
 */
import { pathToFileURL } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isISODate } from '@/domain/dates';
import { tryParseBRL } from '@/domain/money';
import { hashPassword } from '@/server/auth/password';
import { createDb, type AnyDB } from './client';
import { auditLog, bankAccounts, categories, users } from './schema';
import { seedCategories } from './seed-data';

const optional = (s: z.ZodType<string>) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), s.optional());

const userSchema = (n: 1 | 2) =>
  z.object({
    name: z
      .string({ error: `SEED_USER${n}_NAME é obrigatório.` })
      .trim()
      .min(1)
      .max(80),
    email: z
      .email({ error: `SEED_USER${n}_EMAIL precisa ser um email válido.` })
      .trim()
      .toLowerCase()
      .max(160),
    password: z
      .string({ error: `SEED_USER${n}_PASSWORD é obrigatório.` })
      .min(10, { error: `SEED_USER${n}_PASSWORD precisa ter pelo menos 10 caracteres.` }),
    telegramUserId: optional(
      z.string().regex(/^\d+$/, { error: `SEED_USER${n}_TELEGRAM_ID precisa ser numérico.` }),
    ).transform((v) => (v === undefined ? null : Number(v))),
    color: optional(z.string().max(16)).transform((v) => v ?? null),
  });

export const seedConfigSchema = z
  .object({
    users: z.tuple([userSchema(1), userSchema(2)]),
    account: z.object({
      name: z.string().trim().min(1).max(80),
      openingBalance: z.string().transform((v, ctx) => {
        const r = tryParseBRL(v);
        if (!r.ok) {
          ctx.addIssue({ code: 'custom', message: `SEED_OPENING_BALANCE: ${r.error}` });
          return z.NEVER;
        }
        return r.value;
      }),
      openingBalanceDate: z.string().refine(isISODate, {
        error: 'SEED_OPENING_BALANCE_DATE precisa estar no formato AAAA-MM-DD.',
      }),
    }),
  })
  .refine((c) => c.users[0].email !== c.users[1].email, {
    error: 'Os dois usuários precisam de emails diferentes.',
  });

export type SeedConfig = z.output<typeof seedConfigSchema>;

export function seedConfigFromEnv(env: Record<string, string | undefined>): SeedConfig {
  const user = (n: 1 | 2) => ({
    name: env[`SEED_USER${n}_NAME`],
    email: env[`SEED_USER${n}_EMAIL`],
    password: env[`SEED_USER${n}_PASSWORD`],
    telegramUserId: env[`SEED_USER${n}_TELEGRAM_ID`],
    color: env[`SEED_USER${n}_COLOR`],
  });
  const parsed = seedConfigSchema.safeParse({
    users: [user(1), user(2)],
    account: {
      name: env.SEED_ACCOUNT_NAME || 'Conta principal',
      openingBalance: env.SEED_OPENING_BALANCE ?? '',
      openingBalanceDate: env.SEED_OPENING_BALANCE_DATE ?? '',
    },
  });
  if (!parsed.success) {
    throw new Error(
      `Configuração do seed inválida:\n${parsed.error.issues.map((i) => `  - ${i.message}`).join('\n')}`,
    );
  }
  return parsed.data;
}

export type SeedReport = {
  usersCreated: number;
  usersUpdated: number;
  categoriesCreated: number;
  accountCreated: boolean;
};

export async function seed(db: AnyDB, config: SeedConfig): Promise<SeedReport> {
  const hashes = await Promise.all(config.users.map((u) => hashPassword(u.password)));

  return db.transaction(async (tx) => {
    const report: SeedReport = {
      usersCreated: 0,
      usersUpdated: 0,
      categoriesCreated: 0,
      accountCreated: false,
    };

    for (const [i, u] of config.users.entries()) {
      const values = {
        name: u.name,
        email: u.email,
        passwordHash: hashes[i]!,
        telegramUserId: u.telegramUserId,
        color: u.color,
      };
      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, u.email));
      if (existing) {
        await tx.update(users).set(values).where(eq(users.id, existing.id));
        report.usersUpdated++;
      } else {
        const [created] = await tx.insert(users).values(values).returning({ id: users.id });
        await tx.insert(auditLog).values({
          entity: 'users',
          entityId: created!.id,
          action: 'CREATE',
          after: { name: u.name, email: u.email, source: 'SEED' },
        });
        report.usersCreated++;
      }
    }

    for (const kind of ['EXPENSE', 'INCOME'] as const) {
      const rows = seedCategories[kind].map((c) => ({
        name: c.name,
        kind,
        icon: c.icon,
        botAliases: [...c.botAliases],
      }));
      const inserted = await tx
        .insert(categories)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: categories.id });
      report.categoriesCreated += inserted.length;
    }

    const [primary] = await tx
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(eq(bankAccounts.isPrimary, true));
    if (!primary) {
      const after = {
        name: config.account.name,
        isPrimary: true,
        openingBalanceCents: config.account.openingBalance,
        openingBalanceDate: config.account.openingBalanceDate,
      };
      const [created] = await tx.insert(bankAccounts).values(after).returning({ id: bankAccounts.id });
      await tx.insert(auditLog).values({
        entity: 'bank_accounts',
        entityId: created!.id,
        action: 'CREATE',
        after: { ...after, source: 'SEED' },
      });
      report.accountCreated = true;
    }

    // Sanidade: o seed precisa terminar com exatamente 2 usuários e 1 conta principal.
    const [{ count } = { count: 0 }] = await tx.select({ count: sql<number>`count(*)::int` }).from(users);
    if (count !== 2) throw new Error(`Esperava 2 usuários após o seed, encontrei ${count}.`);

    return report;
  });
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('[seed] DATABASE_URL não definida.');
    process.exit(1);
  }
  const { db, client } = createDb(url, { max: 1 });
  try {
    const report = await seed(db, seedConfigFromEnv(process.env));
    console.log('[seed] ok:', report);
    if (!report.accountCreated) console.log('[seed] conta principal já existia: saldo inicial mantido.');
  } catch (err) {
    console.error(`[seed] falhou: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
