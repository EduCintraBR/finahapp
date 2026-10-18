/**
 * Importação da fatura do cartão por OFX (D34–D37), contra Postgres real (PGlite),
 * com a fixture anonimizada que tem a mesma estrutura do OFX real do Nubank.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { createCardPurchase, createOnboardingPlan } from '@/server/card-purchases';
import { createCard } from '@/server/cards';
import type { ServiceCtx } from '@/server/context';
import { acceptAllSuggestions, createAllNew, createFromLine, importCardStatement } from '@/server/imports';
import { freshDb } from './helpers';

const FIXTURE = readFileSync(join(process.cwd(), 'tests/fixtures/nubank-card.ofx'));

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let card: string;
let mercado: string;
let accountId: string;

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;
const lines = (batchId: string) =>
  q<{ memo: string; status: string; suggested: boolean; score: number | null }>(
    `select raw_description memo, status, (suggested_invoice_item_id is not null or suggested_transaction_id is not null) suggested,
            match_score score from import_lines where batch_id = $1 order by line_date desc, raw_description`,
    [batchId],
  );
const invoiceTotals = async (ref: string) =>
  (
    await q<{ total: string; paid: string }>(
      `select coalesce((select sum(i.amount_cents) from invoice_items i where i.invoice_id = v.id and i.status = 'ACTIVE'), 0)::text total,
              coalesce((select sum(t.amount_cents) from transactions t where t.paid_invoice_id = v.id and t.deleted_at is null), 0)::text paid
       from invoices v where v.credit_card_id = $1 and v.reference_month = $2`,
      [card, ref],
    )
  )[0];
const balance = async () =>
  Number(
    (
      await q<{ v: string }>(
        `select a.opening_balance_cents + coalesce(sum(case when t.kind in ('INCOME','TRANSFER_IN','ADJUSTMENT_IN')
           then t.amount_cents else -t.amount_cents end), 0) v
         from bank_accounts a left join transactions t on t.bank_account_id = a.id and t.status = 'POSTED' and t.deleted_at is null
         where a.id = $1 group by a.id`,
        [accountId],
      )
    )[0]!.v,
  );

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
      SEED_OPENING_BALANCE: '5.000,00',
      SEED_OPENING_BALANCE_DATE: '2026-10-01',
    }),
  );
  accountId = (await q<{ id: string }>(`select id from bank_accounts`))[0]!.id;
  mercado = (await q<{ id: string }>(`select id from categories where name = 'Mercado'`))[0]!.id;
  const eduardo = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId: eduardo, today: '2026-10-18' };
  card = (
    await createCard(ctx, {
      name: 'Nubank Eduardo',
      issuer: 'Nubank',
      last4: null,
      isAdditional: false,
      holderName: null,
      limitTotal: 430_000,
      closingDay: 9,
      dueDay: 16,
      botAliases: ['nubank'],
    })
  ).id;
  // o que o usuário já tinha lançado à mão (como no caso real)
  const onboarding = {
    cardId: card,
    categoryId: mercado,
    beneficiaryUserId: null,
    currentInvoiceMonth: '2026-11-01',
  };
  await createOnboardingPlan(ctx, {
    ...onboarding,
    description: 'Loja A',
    total: 7 * 5659,
    installments: 7,
    currentInstallment: 7,
    purchaseDate: '2026-04-20',
  });
  await createOnboardingPlan(ctx, {
    ...onboarding,
    description: 'Exame',
    total: 3 * 13333 + 1,
    installments: 3,
    currentInstallment: 2,
    purchaseDate: '2026-09-16',
  });
  await createCardPurchase(ctx, {
    cardId: card,
    amount: 3022,
    installments: 1,
    description: 'Mercearia (ameixa)',
    categoryId: mercado,
    date: '2026-10-17',
    beneficiaryUserId: null,
    notes: null,
  });
});

const importFixture = (bytes: Uint8Array = FIXTURE, fileName = 'Nubank_2026-11-16.ofx') =>
  importCardStatement(ctx, { cardId: card, fileName, bytes });

describe('importação da fatura (OFX Nubank)', () => {
  it('fluxo completo: sugere, aceita, cria e a fatura fica igual ao saldo do arquivo', async () => {
    const { batchId, inserted, skipped } = await importFixture();
    expect({ inserted, skipped }).toEqual({ inserted: 10, skipped: 0 });

    const suggested = (await lines(batchId))
      .filter((l) => l.suggested)
      .map((l) => l.memo)
      .sort();
    expect(suggested).toEqual(['Clinica B - Parcela 2/3', 'Loja A - Parcela 7/7', 'Mercearia Exemplo Ss']);

    // nada entra sem revisão
    expect((await lines(batchId)).every((l) => l.status === 'PENDING_REVIEW')).toBe(true);
    expect(await q(`select 1 from transactions where source = 'IMPORT'`)).toHaveLength(0);

    expect(await acceptAllSuggestions(ctx, batchId)).toBe(3);
    const r = await createAllNew(ctx, batchId);
    expect(r.created).toBe(6); // 4 compras à vista + 2 pagamentos
    expect(r.skipped.map((s) => [s.description, s.reason])).toEqual([
      ['Farmacia Exemplo', 'confirme o total da compra'],
    ]);

    // D36: o total precisa gerar exatamente a 1ª parcela do arquivo
    const farmacia = r.skipped[0]!.lineId;
    await expect(
      createFromLine(ctx, farmacia, {
        description: 'Farmácia',
        categoryId: mercado,
        beneficiaryUserId: null,
        total: 17_477,
        paymentTarget: null,
      }),
    ).rejects.toThrow('a 1ª parcela seria R$');
    await createFromLine(ctx, farmacia, {
      description: 'Farmácia',
      categoryId: mercado,
      beneficiaryUserId: null,
      total: 17_475,
      paymentTarget: null,
    });

    expect(
      (await q<{ status: string }>(`select status from import_batches where id = $1`, [batchId]))[0]!.status,
    ).toBe('COMPLETED');

    // centavo a centavo: fatura de novembro no app = saldo a pagar do arquivo (R$ 818,61)
    const nov = await invoiceTotals('2026-11-01');
    expect(Number(nov!.total) - Number(nov!.paid)).toBe(81_861);
    // D34: R$ 1.000,00 quitou outubro (que ganhou o saldo anterior) e R$ 50,00 adiantou novembro
    expect(await invoiceTotals('2026-10-01')).toEqual({ total: '100000', paid: '100000' });
    expect(nov!.paid).toBe('5000');
    expect(await balance()).toBe(500_000 - 105_000);
    // a parcela 2/2 da farmácia ficou para dezembro com o valor certo
    const dec = await q<{ amount: string }>(
      `select i.amount_cents::text amount from invoice_items i join invoices v on v.id = i.invoice_id
       where v.reference_month = '2026-12-01' and i.description like 'Farmácia%'`,
    );
    expect(dec).toEqual([{ amount: '8737' }]);
  });

  it('mesmo arquivo duas vezes é bloqueado; arquivo novo com transações repetidas não duplica', async () => {
    await importFixture();
    await expect(importFixture()).rejects.toThrow('já foi importado');
    // reexportação da fatura aberta: mesmo conteúdo + 1 transação nova
    const text = FIXTURE.toString('latin1').replace(
      '</BANKTRANLIST>',
      '<STMTTRN>\r\n<TRNTYPE>DEBIT</TRNTYPE>\r\n<DTPOSTED>20261020000000[-3:BRT]</DTPOSTED>\r\n<TRNAMT>-9.90</TRNAMT>\r\n<FITID>00000000-0000-4000-8000-000000000099</FITID>\r\n<MEMO>Nova Compra</MEMO>\r\n</STMTTRN>\r\n</BANKTRANLIST>',
    );
    const r = await importFixture(Buffer.from(text, 'latin1'), 'Nubank_2026-11-16 (1).ofx');
    expect({ inserted: r.inserted, skipped: r.skipped }).toEqual({ inserted: 1, skipped: 10 });
  });

  it('cartão com fechamento diferente do arquivo: recusa com instrução', async () => {
    // cartão novo, sem faturas materializadas (as datas reais de uma fatura existente valeriam)
    const other = (
      await createCard(ctx, {
        name: 'Outro',
        issuer: null,
        last4: null,
        isAdditional: false,
        holderName: null,
        limitTotal: 100_000,
        closingDay: 3,
        dueDay: 10,
        botAliases: [],
      })
    ).id;
    await expect(
      importCardStatement(ctx, { cardId: other, fileName: 'x.ofx', bytes: FIXTURE }),
    ).rejects.toThrow('configurado para fechar no dia 3');
  });

  it('OFX de conta corrente no cartão: recusa', async () => {
    const bank = `<OFX><BANKMSGSRSV1><STMTRS><BANKTRANLIST><DTEND>20261109</DTEND><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261010</DTPOSTED><TRNAMT>-1.00</TRNAMT><FITID>Z</FITID><MEMO>x</MEMO></STMTTRN></BANKTRANLIST></STMTRS></BANKMSGSRSV1></OFX>`;
    await expect(importFixture(Buffer.from(bank))).rejects.toThrow('conta corrente');
  });
});
