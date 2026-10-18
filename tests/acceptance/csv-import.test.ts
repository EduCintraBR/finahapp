/**
 * Importação por CSV (Fase 5): extrato da conta e fatura do cartão do Nubank, no mesmo fluxo do OFX.
 * Postgres real (PGlite). Os CSVs são sintéticos, no formato descrito pelo adaptador.
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
import { createCard } from '@/server/cards';
import type { ServiceCtx } from '@/server/context';
import { createAllNew, importCardStatement } from '@/server/imports';
import { freshDb } from './helpers';

const OCT = readFileSync(join(process.cwd(), 'tests/fixtures/nubank-account.ofx'));
const enc = (s: string) => new TextEncoder().encode(s);

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let accountId: string;
let nubank: string;

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;

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
  nubank = (
    await createCard(ctx, {
      name: 'Nubank',
      issuer: 'Nubank',
      last4: null,
      isAdditional: false,
      holderName: null,
      limitTotal: 430_000,
      closingDay: 9,
      dueDay: 16,
      botAliases: [],
    })
  ).id;
});

describe('CSV do extrato da conta', () => {
  it('importa, guarda o formato e não duplica o que já veio pelo OFX (Identificador = FITID)', async () => {
    await importAccountStatement(ctx, { fileName: 'out.ofx', bytes: OCT });
    const csv = [
      'Data,Valor,Identificador,Descrição',
      // duas linhas que já vieram no OFX (mesmo identificador) e uma nova
      '01/10/2026,-67.81,10000000-0000-4000-8000-000000000001,Transferência enviada pelo Pix - RECEITA FEDERAL',
      '15/10/2026,-282.63,10000000-0000-4000-8000-000000000010,Pagamento de boleto efetuado - PLANO DE SAUDE EXEMPLO',
      '17/10/2026,-20.00,20000000-0000-4000-8000-0000000000aa,Compra no débito - PADARIA EXEMPLO',
    ].join('\n');
    const r = await importAccountStatement(ctx, { fileName: 'conta.csv', bytes: enc(csv) });
    expect(r).toMatchObject({ inserted: 1, skipped: 2 });
    const [b] = await q<{ format: string; period_start: string | null }>(
      `select format::text, period_start::text from import_batches where id = $1`,
      [r.batchId],
    );
    expect(b).toEqual({ format: 'CSV', period_start: null });
  });

  it('recuar o início com CSV: sem saldo no arquivo, parte do saldo atual e avisa que não dá para conferir', async () => {
    const csv = [
      'Data,Valor,Identificador,Descrição',
      '05/09/2026,5000.00,20000000-0000-4000-8000-000000000001,Transferência Recebida - EMPRESA TESTE',
      '10/09/2026,-1234.56,20000000-0000-4000-8000-000000000002,Compra no débito - MERCEARIA EXEMPLO',
      '20/09/2026,-765.44,20000000-0000-4000-8000-000000000003,Pagamento de boleto efetuado - PLANO DE SAUDE EXEMPLO',
      '28/09/2026,-2000.00,20000000-0000-4000-8000-000000000004,Transferência enviada pelo Pix - JOAO PROPRIETARIO',
    ].join('\n');
    const p = await previewAccountBackfill(ctx, { bytes: enc(csv) });
    expect(p!.plan).toMatchObject({
      method: 'CONTINUITY',
      newDate: '2026-09-05',
      newOpeningCents: 0, // 1.000,00 − (+5.000,00 −1.234,56 −765,44 −2.000,00)
      check: { status: 'UNVERIFIABLE' },
      blocking: false,
    });
    const { batchId } = await importAccountStatement(ctx, {
      fileName: 'set.csv',
      bytes: enc(csv),
      backfill: true,
    });
    expect(await createAllNewAccountLines(ctx, batchId)).toMatchObject({ created: 4, skipped: [] });
    // o saldo em 01/10 continua o de antes do recuo
    expect(await getAccountBalance(db, accountId, '2026-10-01')).toBe(100_000);
  });

  it('recusa CSV de cartão na tela da conta e CSV com valor inválido, dizendo a linha', async () => {
    await expect(
      importAccountStatement(ctx, {
        fileName: 'x.csv',
        bytes: enc('date,title,amount\n2026-10-10,Loja,1.00\n'),
      }),
    ).rejects.toThrow('parece ser de uma fatura de cartão');
    await expect(
      importAccountStatement(ctx, {
        fileName: 'x.csv',
        bytes: enc('Data,Valor,Descrição\n01/10/2026,abc,x\n'),
      }),
    ).rejects.toThrow(/Linha 2.*valor inválido/);
  });
});

describe('CSV da fatura do cartão', () => {
  const csv = [
    'date,category,title,amount',
    '2026-10-12,restaurante,iFood Delivery,36.13',
    '2026-10-20,saúde,Drogaria Exemplo,39.00',
    '2026-11-03,compras,Loja Exemplo,100.00',
  ].join('\n');

  it('pede o mês da fatura (o CSV não traz o período) e importa na fatura escolhida', async () => {
    await expect(
      importCardStatement(ctx, { cardId: nubank, fileName: 'f.csv', bytes: enc(csv) }),
    ).rejects.toThrow('O CSV não traz o período da fatura');
    const r = await importCardStatement(ctx, {
      cardId: nubank,
      fileName: 'f.csv',
      bytes: enc(csv),
      referenceMonth: '2026-11-01',
    });
    expect(r.inserted).toBe(3);
    const [b] = await q<{ format: string; ref: string; period_end: string }>(
      `select b.format::text, v.reference_month::text ref, b.period_end::text from import_batches b join invoices v on v.id = b.invoice_id where b.id = $1`,
      [r.batchId],
    );
    expect(b).toEqual({ format: 'CSV', ref: '2026-11-01', period_end: '2026-11-09' }); // fecha dia 9

    expect(await createAllNew(ctx, r.batchId)).toMatchObject({ created: 3, skipped: [] });
    const [t] = await q<{ total: string }>(
      `select sum(ii.amount_cents)::text total from invoice_items ii join invoices v on v.id = ii.invoice_id where v.reference_month = '2026-11-01'`,
    );
    expect(t!.total).toBe(String(3_613 + 3_900 + 10_000));
  });

  it('reimportar o mesmo CSV é bloqueado; um CSV que se sobrepõe só traz as linhas novas', async () => {
    const opts = { cardId: nubank, referenceMonth: '2026-11-01' as const };
    await importCardStatement(ctx, { ...opts, fileName: 'f.csv', bytes: enc(csv) });
    await expect(importCardStatement(ctx, { ...opts, fileName: 'f.csv', bytes: enc(csv) })).rejects.toThrow(
      'já foi importado',
    );
    const more = `${csv}\n2026-11-05,lazer,Cinema Exemplo,50.00`;
    const r = await importCardStatement(ctx, { ...opts, fileName: 'f2.csv', bytes: enc(more) });
    expect(r).toMatchObject({ inserted: 1, skipped: 3 });
  });

  it('recusa o CSV do extrato da conta no cartão (os sinais sairiam invertidos)', async () => {
    await expect(
      importCardStatement(ctx, {
        cardId: nubank,
        fileName: 'x.csv',
        bytes: enc('Data,Valor,Identificador,Descrição\n01/10/2026,-1.00,abc,x\n'),
        referenceMonth: '2026-11-01',
      }),
    ).rejects.toThrow('parece ser do extrato da conta');
  });
});
