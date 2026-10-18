/**
 * D50: importar um mês anterior ao início do controle recuando o saldo inicial (extrato de setembro, com o
 * controle começando em 01/10). Postgres real (PGlite), fixture anonimizada.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { getAccountBalance } from '@/db/queries/balance';
import { seed, seedConfigFromEnv } from '@/db/seed';
import {
  createAllNewAccountLines,
  importAccountStatement,
  previewAccountBackfill,
} from '@/server/account-imports';
import { updateOpeningBalance } from '@/server/account-settings';
import type { ServiceCtx } from '@/server/context';
import { freshDb } from './helpers';

const SEP = readFileSync(join(process.cwd(), 'tests/fixtures/nubank-account-sep.ofx'));
const OCT = readFileSync(join(process.cwd(), 'tests/fixtures/nubank-account.ofx'));

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let accountId: string;

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;
const opening = async () =>
  (
    await q<{ c: string; d: string }>(
      `select opening_balance_cents::text c, opening_balance_date::text d from bank_accounts`,
    )
  )[0]!;

beforeEach(async () => {
  ({ pg, db } = await freshDb());
  await seed(
    db,
    seedConfigFromEnv({
      SEED_USER1_NAME: 'Eduardo',
      SEED_USER1_EMAIL: 'eduardo@example.com',
      SEED_USER1_PASSWORD: 'senha-do-eduardo',
      SEED_USER2_NAME: 'Viviane',
      SEED_USER2_EMAIL: 'viviane@example.com',
      SEED_USER2_PASSWORD: 'senha-da-viviane',
      SEED_OPENING_BALANCE: '1.000,00',
      SEED_OPENING_BALANCE_DATE: '2026-10-01',
    }),
  );
  accountId = (await q<{ id: string }>(`select id from bank_accounts`))[0]!.id;
  const userId = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId, today: '2026-10-18' };
});

describe('importar setembro com o controle começando em 01/10', () => {
  it('a prévia mostra o recuo calculado do arquivo e que ele bate com o saldo atual', async () => {
    const p = await previewAccountBackfill(ctx, { bytes: SEP });
    expect(p).toMatchObject({
      oldDate: '2026-10-01',
      oldOpeningCents: 100_000,
      plan: {
        newDate: '2026-09-01',
        newOpeningCents: 0,
        method: 'LEDGER',
        earlyLines: 4,
        check: { status: 'OK' },
        blocking: false,
      },
    });
    // o arquivo de outubro não tem nada anterior ao início: nada a recuar
    expect(await previewAccountBackfill(ctx, { bytes: OCT })).toBeNull();
    // a prévia não grava nada
    expect(await opening()).toEqual({ c: '100000', d: '2026-10-01' });
  });

  it('sem confirmar, recusa e não muda nada; confirmando, recua, importa e o saldo bate com o arquivo', async () => {
    await expect(importAccountStatement(ctx, { fileName: 'set.ofx', bytes: SEP })).rejects.toThrow(
      'Confirme o recuo',
    );
    expect(await opening()).toEqual({ c: '100000', d: '2026-10-01' });
    expect(await q(`select 1 from import_batches`)).toHaveLength(0);

    const { batchId, inserted } = await importAccountStatement(ctx, {
      fileName: 'set.ofx',
      bytes: SEP,
      backfill: true,
    });
    expect(inserted).toBe(4);
    expect(await opening()).toEqual({ c: '0', d: '2026-09-01' });

    // trilha de auditoria: quem recuou, de quê para quê, e o motivo
    const [a] = await q<{
      before: { openingBalanceDate: string };
      after: { openingBalanceDate: string; reason: string };
    }>(`select before, after from audit_log where entity = 'bank_accounts' and action = 'UPDATE'`);
    expect(a).toMatchObject({
      before: { openingBalanceDate: '2026-10-01' },
      after: { openingBalanceDate: '2026-09-01', reason: 'D50' },
    });

    expect(await createAllNewAccountLines(ctx, batchId)).toEqual({ created: 4, skipped: [] });
    // o saldo do app no fim do arquivo (30/09) é o do banco, e na virada continua o de antes (R$ 1.000,00)
    expect(await getAccountBalance(db, accountId, '2026-09-30')).toBe(100_000);
    expect(await getAccountBalance(db, accountId, '2026-10-01')).toBe(100_000);

    // depois do recuo o arquivo de outubro importa normalmente e a mesma foto de setembro não entra duas vezes
    await expect(
      importAccountStatement(ctx, { fileName: 'set.ofx', bytes: SEP, backfill: true }),
    ).rejects.toThrow('já foi importado');
    await expect(importAccountStatement(ctx, { fileName: 'out.ofx', bytes: OCT })).resolves.toBeTruthy();
  });

  it('saldo do arquivo que não bate com o saldo inicial atual: bloqueia, explica a diferença e não muda nada', async () => {
    await updateOpeningBalance(ctx, { amount: 150_000, date: '2026-10-01' }); // o app achava R$ 1.500,00
    const p = await previewAccountBackfill(ctx, { bytes: SEP });
    expect(p!.plan).toMatchObject({ blocking: true, check: { status: 'MISMATCH', diffCents: -50_000 } });
    await expect(
      importAccountStatement(ctx, { fileName: 'set.ofx', bytes: SEP, backfill: true }),
    ).rejects.toThrow(/não bate com o saldo inicial do app \(R\$\s1\.500,00\)/);
    expect(await opening()).toEqual({ c: '150000', d: '2026-10-01' });
    expect(await q(`select 1 from import_batches`)).toHaveLength(0);
    expect(await q(`select 1 from import_lines`)).toHaveLength(0);
  });

  it('recuar de novo para um mês ainda mais antigo encadeia: cada arquivo ancora no saldo do anterior', async () => {
    await importAccountStatement(ctx, { fileName: 'set.ofx', bytes: SEP, backfill: true });
    // agosto: termina com R$ 0,00 (o saldo inicial de 01/09) e movimenta +300,00 − 100,00
    const aug = SEP.toString('utf8')
      .replace(/DTSTART>20260901/, 'DTSTART>20260801')
      .replace(/DTEND>20260930/, 'DTEND>20260831')
      .replace(/<DTPOSTED>2026090\d|<DTPOSTED>202609[12]\d/g, '<DTPOSTED>20260810')
      .replace(/<BALAMT>1000.00/, '<BALAMT>0.00')
      .replace(/<DTASOF>20260930/, '<DTASOF>20260831')
      .replace(/<TRNAMT>5000.00/, '<TRNAMT>300.00')
      .replace(/<TRNAMT>-1234.56/, '<TRNAMT>-100.00')
      .replace(/<TRNAMT>-765.44/, '<TRNAMT>-200.00')
      .replace(/<TRNAMT>-2000.00/, '<TRNAMT>0.01')
      .replace(/-0000-4000-8000-00000000000(\d)/g, '-0000-4000-8000-00000000009$1');
    const p = await previewAccountBackfill(ctx, { bytes: Buffer.from(aug, 'utf8') });
    // 4 linhas: +300,00 −100,00 −200,00 +0,01 = +0,01 → saldo em 01/08 = 0,00 − 0,01
    expect(p!.plan).toMatchObject({ newDate: '2026-08-01', newOpeningCents: -1, check: { status: 'OK' } });
  });
});
