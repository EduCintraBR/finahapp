/**
 * Importação do extrato da conta por OFX (D44–D47), contra Postgres real (PGlite),
 * com a fixture anonimizada que tem a mesma estrutura do OFX real da conta Nubank.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { getAccountBalance } from '@/db/queries/balance';
import { grossSpend, monthlySpend, total } from '@/db/queries/reports';
import { seed, seedConfigFromEnv } from '@/db/seed';
import {
  acceptAllAccountSuggestions,
  createAllNewAccountLines,
  createFromAccountLine,
  importAccountStatement,
} from '@/server/account-imports';
import { updateOpeningBalance } from '@/server/account-settings';
import { createCardPurchase } from '@/server/card-purchases';
import { createCard } from '@/server/cards';
import type { ServiceCtx } from '@/server/context';
import { createEntry } from '@/server/entries';
import { importCardStatement } from '@/server/imports';
import { payInvoice } from '@/server/invoice-ops';
import { createTemplate } from '@/server/recurring';
import { freshDb } from './helpers';

const FIXTURE = readFileSync(join(process.cwd(), 'tests/fixtures/nubank-account.ofx'));

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let accountId: string;
let nubank: string;
let adicional: string;
const cat: Record<string, string> = {};

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;
const lineId = async (fitSuffix: string) =>
  (await q<{ id: string }>(`select id from import_lines where dedup_key like $1`, [`%${fitSuffix}`]))[0]!.id;

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
      SEED_OPENING_BALANCE: '0,00',
      SEED_OPENING_BALANCE_DATE: '2026-10-01',
    }),
  );
  for (const r of await q<{ id: string; name: string }>(`select id, name from categories`))
    cat[r.name] = r.id;
  accountId = (await q<{ id: string }>(`select id from bank_accounts`))[0]!.id;
  const eduardo = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId: eduardo, today: '2026-10-18' };

  // o que já existia no app (como no caso real)
  await createEntry(ctx, {
    kind: 'INCOME',
    amount: 700_000,
    description: 'Salário (PJ)',
    categoryId: cat['Renda PJ']!,
    paymentMethod: 'PIX',
    date: '2026-10-15',
    beneficiaryUserId: null,
    notes: null,
  });
  await createTemplate(ctx, {
    type: 'FIXED',
    direction: 'EXPENSE',
    description: 'Aluguel',
    categoryId: cat['Moradia']!,
    amount: 162_100,
    dayOfMonth: 15,
    paymentMethod: 'PIX',
    creditCardId: null,
    startMonth: '2026-10-01',
    endMonth: null,
    beneficiaryUserId: null,
  });
  const card = (over: object) =>
    createCard(ctx, {
      name: 'x',
      issuer: 'Nubank',
      last4: null,
      isAdditional: false,
      holderName: null,
      limitTotal: 430_000,
      closingDay: 9,
      dueDay: 16,
      botAliases: [],
      ...over,
    });
  nubank = (await card({ name: 'Nubank Eduardo' })).id;
  adicional = (await card({ name: 'Adicional', isAdditional: true, holderName: 'Mãe', limitTotal: null })).id;
  // pagamento de fatura já lançado pela importação do cartão
  await importCardStatement(ctx, {
    cardId: nubank,
    fileName: 'cartao.ofx',
    bytes: readFileSync(join(process.cwd(), 'tests/fixtures/nubank-card.ofx')),
  });
  const nov = (
    await q<{ id: string }>(
      `select id from invoices where credit_card_id = $1 and reference_month = '2026-11-01'`,
      [nubank],
    )
  )[0]!.id;
  await payInvoice(ctx, nov, { amount: 11_359, date: '2026-10-15', paymentMethod: 'OTHER' });
  await createCardPurchase(ctx, {
    cardId: adicional,
    amount: 47_000,
    installments: 1,
    description: 'Compras no adicional',
    categoryId: cat['Compras']!,
    date: '2026-10-05',
    beneficiaryUserId: null,
    notes: null,
  });
});

describe('saldo inicial (D44)', () => {
  it('corrige com audit_log e não deixa a data passar de um lançamento', async () => {
    await updateOpeningBalance(ctx, { amount: 100_000, date: '2026-10-01' });
    expect(await getAccountBalance(db, accountId, '2026-09-30')).toBe(100_000);
    expect(
      await q(`select 1 from audit_log where entity = 'bank_accounts' and action = 'UPDATE'`),
    ).toHaveLength(1);
    await expect(updateOpeningBalance(ctx, { amount: 0, date: '2026-10-16' })).rejects.toThrow(
      'antes da nova data',
    );
  });
});

describe('importação do extrato da conta', () => {
  it('concilia, dá baixa, cria e o saldo do app bate com o do arquivo', async () => {
    await updateOpeningBalance(ctx, { amount: 100_000, date: '2026-10-01' });
    // o pagamento já foi conciliado com a linha da FATURA (importação do cartão): o lado da conta
    // ainda precisa poder conciliá-lo (caso real de 18/10/2026)
    await q(
      `update import_lines set status = 'MATCHED', matched_transaction_id = (select id from transactions where kind = 'INVOICE_PAYMENT')
       where id = (select id from import_lines where credit_card_id is not null and status = 'PENDING_REVIEW' limit 1)`,
    );
    const { batchId, inserted } = await importAccountStatement(ctx, {
      fileName: 'NU_conta.ofx',
      bytes: FIXTURE,
    });
    expect(inserted).toBe(12);

    const suggested = await q<{ memo: string }>(
      `select raw_description memo from import_lines where batch_id = $1 and suggested_transaction_id is not null order by 1`,
      [batchId],
    );
    expect(suggested.map((s) => s.memo.slice(0, 30))).toEqual([
      'Pagamento de fatura',
      'Transferência Recebida - 12.34',
      'Transferência enviada pelo Pix',
    ]);

    expect(await acceptAllAccountSuggestions(ctx, batchId)).toBe(3);
    // D47: o aluguel pendente recebeu a baixa com a data da linha
    const [aluguel] = await q<{ status: string; posted: string }>(
      `select status, posted_date::text posted from transactions where description = 'Aluguel'`,
    );
    expect(aluguel).toEqual({ status: 'POSTED', posted: '2026-10-15' });

    // D46: Pix para a titular = pagamento da fatura do adicional
    const adInvoice = (
      await q<{ id: string }>(`select id from invoices where credit_card_id = $1`, [adicional])
    )[0]!.id;
    await createFromAccountLine(ctx, await lineId('12'), {
      kind: 'INVOICE_PAYMENT',
      description: 'Fatura do adicional',
      categoryId: null,
      beneficiaryUserId: null,
      invoiceId: adInvoice,
    });

    const r = await createAllNewAccountLines(ctx, batchId);
    expect(r).toEqual({ created: 8, skipped: [] });
    expect(
      (await q<{ status: string }>(`select status from import_batches where id = $1`, [batchId]))[0]!.status,
    ).toBe('COMPLETED');

    // saldo do app na data final do arquivo = saldo do arquivo
    expect(await getAccountBalance(db, accountId, '2026-10-17')).toBe(556_594);

    // D45: RDB e Pix entre contas próprias viram transferência e não contam como gasto/receita
    const transfers = await q<{ kind: string; n: number }>(
      `select kind, count(*)::int n from transactions where kind::text like 'TRANSFER%' group by kind order by kind`,
    );
    expect(transfers).toEqual([
      { kind: 'TRANSFER_IN', n: 2 },
      { kind: 'TRANSFER_OUT', n: 2 },
    ]);
    const accountExpenses = 6781 + 1700 + 3613 + 28_263 + 162_100;
    expect(
      total(await monthlySpend(db, '2026-10-01', '2026-10-31', 'category', { paymentMethod: 'PIX' })),
    ).toBe(6781 + 162_100);
    expect(
      total(
        await grossSpend(db, '2026-10-01', '2026-10-31', 'category', {
          cardId: undefined,
          paymentMethod: 'DEBIT',
        }),
      ),
    ).toBe(1700 + 3613);
    expect(total(await grossSpend(db, '2026-10-01', '2026-10-31', 'category'))).toBe(
      accountExpenses + 47_000,
    );
    // pagamento do adicional entrou na fatura dele
    const [ad] = await q<{ paid: string }>(
      `select coalesce(sum(amount_cents),0)::text paid from transactions where paid_invoice_id = $1`,
      [adInvoice],
    );
    expect(ad!.paid).toBe('47000');
  });

  it('bloqueios: mesmo arquivo, OFX de cartão, lançamentos antes do início', async () => {
    await importAccountStatement(ctx, { fileName: 'a.ofx', bytes: FIXTURE });
    await expect(importAccountStatement(ctx, { fileName: 'a.ofx', bytes: FIXTURE })).rejects.toThrow(
      'já foi importado',
    );
    await expect(
      importAccountStatement(ctx, {
        fileName: 'c.ofx',
        bytes: readFileSync(join(process.cwd(), 'tests/fixtures/nubank-card.ofx')),
      }),
    ).rejects.toThrow('cartão de crédito');
    const early = FIXTURE.toString('utf8')
      .replace('20261002000000', '20260930000000')
      .replace('Compra no débito - MERCEARIA', 'Compra no débito - MERCEARIA X');
    await expect(
      importAccountStatement(ctx, { fileName: 'b.ofx', bytes: Buffer.from(early, 'utf8') }),
    ).rejects.toThrow('início do controle');
  });
});
