/**
 * Ferramentas da revisão (Fase 5): ignorar em lote, trocar match, atualizar sugestões e a mensagem da compra
 * anterior ao início do controle. Postgres real (PGlite), fixtures anonimizadas.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { getBatchCandidates } from '@/db/queries/imports';
import { seed, seedConfigFromEnv } from '@/db/seed';
import {
  acceptAccountMatch,
  importAccountStatement,
  refreshAccountSuggestions,
} from '@/server/account-imports';
import { createCardPurchase } from '@/server/card-purchases';
import { createCard } from '@/server/cards';
import type { ServiceCtx } from '@/server/context';
import { createEntry } from '@/server/entries';
import { ignoreLines, importCardStatement, createFromLine } from '@/server/imports';
import { payInvoice } from '@/server/invoice-ops';
import { freshDb } from './helpers';

const OCT = readFileSync(join(process.cwd(), 'tests/fixtures/nubank-account.ofx'));
const CARD = readFileSync(join(process.cwd(), 'tests/fixtures/nubank-card.ofx'));

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let batchId: string;
let nubank: string;
const cat: Record<string, string> = {};

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;
const line = async (suffix: string) =>
  (await q<{ id: string }>(`select id from import_lines where dedup_key like $1`, [`%${suffix}`]))[0]!.id;
const statusOf = async (id: string) =>
  (await q<{ status: string }>(`select status from import_lines where id = $1`, [id]))[0]!.status;

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
  for (const r of await q<{ id: string; name: string }>(`select id, name from categories`))
    cat[r.name] = r.id;
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
  batchId = (await importAccountStatement(ctx, { fileName: 'out.ofx', bytes: OCT })).batchId;
});

describe('ignorar em lote', () => {
  it('as marcadas; e todas menos as marcadas (cartão adicional)', async () => {
    const [a, b, c] = [await line('01'), await line('02'), await line('03')];
    expect(await ignoreLines(ctx, batchId, { mode: 'SELECTED', lineIds: [a, b] })).toBe(2);
    expect(await statusOf(a)).toBe('IGNORED');
    expect(await statusOf(b)).toBe('IGNORED');
    expect(await statusOf(c)).toBe('PENDING_REVIEW');

    // todas as que restam, menos a marcada
    const keep = await line('04');
    const left = (
      await q<{ n: number }>(`select count(*)::int n from import_lines where status = 'PENDING_REVIEW'`)
    )[0]!.n;
    expect(await ignoreLines(ctx, batchId, { mode: 'EXCEPT', lineIds: [keep] })).toBe(left - 1);
    expect(await q(`select 1 from import_lines where status = 'PENDING_REVIEW'`)).toHaveLength(1);
    expect(await statusOf(keep)).toBe('PENDING_REVIEW');
    expect((await q<{ status: string }>(`select status from import_batches`))[0]!.status).toBe('IN_REVIEW');
    expect(
      await q(`select 1 from audit_log where entity = 'import_batches' and action = 'UPDATE'`),
    ).toHaveLength(2);
  });

  it('erros em pt-BR: nada marcado, ou nada a ignorar; ids de outro lote são ignorados', async () => {
    await expect(ignoreLines(ctx, batchId, { mode: 'SELECTED', lineIds: [] })).rejects.toThrow(
      'Marque as linhas',
    );
    await expect(
      ignoreLines(ctx, batchId, { mode: 'SELECTED', lineIds: ['00000000-0000-4000-8000-000000000000'] }),
    ).rejects.toThrow('Nenhuma linha pendente');
    expect(await q(`select 1 from import_lines where status = 'IGNORED'`)).toHaveLength(0);
  });

  it('ignorar todas encerra o lote', async () => {
    expect(await ignoreLines(ctx, batchId, { mode: 'EXCEPT', lineIds: [] })).toBe(12);
    expect((await q<{ status: string }>(`select status from import_batches`))[0]!.status).toBe('COMPLETED');
  });
});

describe('trocar match', () => {
  it('lista os lançamentos de mesmo valor ainda sem par e o aceitar usa o escolhido', async () => {
    // a linha de R$ 67,81 (RECEITA FEDERAL, 01/10) ainda não tem sugestão (nada lançado). Cria dois candidatos.
    await createEntry(ctx, {
      kind: 'EXPENSE',
      amount: 6_781,
      description: 'Imposto',
      categoryId: cat['Outros']!,
      paymentMethod: 'PIX',
      date: '2026-10-03',
      beneficiaryUserId: null,
      notes: null,
    });
    await createEntry(ctx, {
      kind: 'EXPENSE',
      amount: 6_781,
      description: 'Outro imposto',
      categoryId: cat['Outros']!,
      paymentMethod: 'PIX',
      date: '2026-10-12',
      beneficiaryUserId: null,
      notes: null,
    });
    await createEntry(ctx, {
      kind: 'EXPENSE',
      amount: 6_781,
      description: 'Longe demais',
      categoryId: cat['Outros']!,
      paymentMethod: 'PIX',
      date: '2026-12-30',
      beneficiaryUserId: null,
      notes: null,
    });
    const l = await line('01');
    const cands = (await getBatchCandidates(db, batchId))[l]!;
    // só os dentro da janela, do mais próximo ao mais distante; "Longe demais" fica de fora
    expect(cands.map((c) => c.label)).toEqual(['Imposto', 'Outro imposto']);

    await acceptAccountMatch(ctx, l, cands[1]!.id); // escolhe o segundo, não o mais próximo
    expect(
      (
        await q<{ matched_transaction_id: string }>(
          `select matched_transaction_id from import_lines where id = $1`,
          [l],
        )
      )[0]!.matched_transaction_id,
    ).toBe(cands[1]!.id);
    // o escolhido não aparece mais para outras linhas; o outro continua livre
    const after = await getBatchCandidates(db, batchId);
    expect(
      Object.values(after)
        .flat()
        .map((c) => c.label),
    ).not.toContain('Outro imposto');
  });

  it('valor diferente ou direção errada nunca é candidato, e o aceitar recusa o que não corresponde', async () => {
    const e = await createEntry(ctx, {
      kind: 'INCOME',
      amount: 6_781,
      description: 'Entrada de mesmo valor',
      categoryId: cat['Renda extra']!,
      paymentMethod: 'PIX',
      date: '2026-10-02',
      beneficiaryUserId: null,
      notes: null,
    });
    const l = await line('01'); // saída de R$ 67,81
    expect((await getBatchCandidates(db, batchId))[l]).toEqual([]);
    await expect(acceptAccountMatch(ctx, l, e.id)).rejects.toThrow('não corresponde');
  });
});

describe('atualizar sugestões', () => {
  it('o pagamento da fatura lançado depois passa a ser sugerido na linha do extrato', async () => {
    const pay = await line('11'); // "Pagamento de fatura" R$ 113,59
    expect(
      (
        await q<{ s: string | null }>(`select suggested_transaction_id s from import_lines where id = $1`, [
          pay,
        ])
      )[0]!.s,
    ).toBeNull();

    await createCardPurchase(ctx, {
      cardId: nubank,
      amount: 11_359,
      installments: 1,
      description: 'Compra',
      categoryId: cat['Compras']!,
      date: '2026-10-05',
      beneficiaryUserId: null,
      notes: null,
    });
    const inv = (await q<{ id: string }>(`select id from invoices where credit_card_id = $1`, [nubank]))[0]!
      .id;
    const { transactionId } = await payInvoice(ctx, inv, {
      amount: 11_359,
      date: '2026-10-15',
      paymentMethod: 'OTHER',
    });

    await refreshAccountSuggestions(ctx, batchId);
    expect(
      (await q<{ s: string }>(`select suggested_transaction_id s from import_lines where id = $1`, [pay]))[0]!
        .s,
    ).toBe(transactionId);
  });
});

describe('fatura com compra anterior ao início do controle', () => {
  it('a mensagem diz como resolver (importar o extrato do período, que recua o início)', async () => {
    const { batchId: b } = await importCardStatement(ctx, {
      cardId: nubank,
      fileName: 'cartao.ofx',
      bytes: CARD,
    });
    const purchase = (
      await q<{ id: string; d: string }>(
        `select id, line_date::text d from import_lines where batch_id = $1 and raw_payload->>'kind' = 'PURCHASE' order by line_date limit 1`,
        [b],
      )
    )[0]!;
    // o controle começa depois da compra mais antiga da fatura
    await q(`update bank_accounts set opening_balance_date = '2026-12-31'`);
    await expect(
      createFromLine(ctx, purchase.id, {
        description: 'x',
        categoryId: cat['Compras']!,
        beneficiaryUserId: null,
        total: null,
        paymentTarget: null,
      }),
    ).rejects.toThrow(/anterior ao início do controle.*importe antes o extrato da conta/);
  });
});
