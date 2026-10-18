/**
 * Teste de aceitação do razão do cartão e das fórmulas canônicas.
 * Roda contra um Postgres real embutido (PGlite) aplicando as migrações do drizzle-kit.
 * As queries aqui são a REFERÊNCIA: a implementação em src/ deve produzir os mesmos números.
 *
 *   pnpm add -D vitest @electric-sql/pglite
 *   pnpm vitest run tests/acceptance
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');

let db: PGlite;
const q = async <T = any>(s: string, p: unknown[] = []) => (await db.query<T>(s, p as any[])).rows;
const one = async <T = any>(s: string, p: unknown[] = []) => (await q<T>(s, p))[0];
const rejects = (s: string, p: unknown[] = [], constraint?: string | RegExp) =>
  expect(db.query(s, p as any[])).rejects.toThrow(constraint ?? /violates/);

// ─────────── fórmulas canônicas (referência) ───────────
const availableLimit = async (cardId: string): Promise<number | null> => {
  const r = await one(`
    select case when c.limit_total_cents is null then null else
      c.limit_total_cents
      - coalesce((select sum(i.amount_cents) from invoice_items i
                  where i.credit_card_id = c.id and i.status = 'ACTIVE'), 0)
      + coalesce((select sum(t.amount_cents) from transactions t
                  join invoices v on v.id = t.paid_invoice_id
                  where v.credit_card_id = c.id and t.kind = 'INVOICE_PAYMENT'
                    and t.status = 'POSTED' and t.deleted_at is null), 0)
    end as v
    from credit_cards c where c.id = $1`, [cardId]);
  return r.v === null ? null : Number(r.v);
};

const balance = async (accountId: string) => Number((await one(`
  select a.opening_balance_cents + coalesce(sum(case
      when t.kind in ('INCOME','TRANSFER_IN','ADJUSTMENT_IN') then t.amount_cents
      else -t.amount_cents end), 0) as v
  from bank_accounts a
  left join transactions t on t.bank_account_id = a.id and t.status = 'POSTED' and t.deleted_at is null
  where a.id = $1 group by a.id`, [accountId])).v);

const invoiceTotal = async (invoiceId: string) => Number((await one(
  `select coalesce(sum(amount_cents),0) v from invoice_items where invoice_id = $1 and status = 'ACTIVE'`,
  [invoiceId])).v);

/** Gasto Bruto do mês: compras pela data do fato − estornos pela data do estorno. */
const grossSpend = async (month: string) => Number((await one(`
  select
    coalesce((select sum(amount_cents) from transactions
              where kind = 'EXPENSE' and status <> 'CANCELLED' and deleted_at is null
                and source <> 'ONBOARDING'
                and date_trunc('month', transaction_date) = $1::date), 0)
  - coalesce((select sum(amount_cents) from refund_records
              where date_trunc('month', refund_date) = $1::date), 0) as v`, [month])).v);

// ─────────── fixtures ───────────
let user: string, account: string, cat: string, card: string;
let nov: string, dec: string, jan: string;

const newInvoice = async (cardId: string, ref: string, closing: string, due: string) =>
  (await one(`insert into invoices(credit_card_id, reference_month, closing_date, due_date)
              values ($1,$2,$3,$4) returning id`, [cardId, ref, closing, due])).id as string;

/** Compra no cartão: transaction + plano + parcelas (resto do arredondamento na 1ª). */
const cardPurchase = async (opts: {
  total: number; n: number; date: string; invoices: string[]; firstTracked?: number;
  source?: string; cardId?: string;
}) => {
  const cardId = opts.cardId ?? card;
  const tx = await one(`insert into transactions(kind, description, amount_cents, payment_method,
      credit_card_id, category_id, transaction_date, posted_date, created_by_user_id, source)
    values ('EXPENSE','Compra',$1,'CREDIT_CARD',$2,$3,$4,$4,$5,$6) returning id`,
    [opts.total, cardId, cat, opts.date, user, opts.source ?? 'MANUAL']);
  const first = opts.firstTracked ?? 1;
  const plan = await one(`insert into installment_plans(transaction_id, credit_card_id, total_amount_cents,
      installment_count, first_tracked_installment, purchase_date, first_invoice_id)
    values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [tx.id, cardId, opts.total, opts.n, first, opts.date, opts.invoices[0]]);
  const base = Math.floor(opts.total / opts.n);
  const rest = opts.total - base * opts.n;
  for (let k = first; k <= opts.n; k++) {
    await q(`insert into invoice_items(invoice_id, credit_card_id, kind, amount_cents, description,
        posting_date, installment_plan_id, installment_number)
      values ($1,$2,'INSTALLMENT',$3,$4,$5,$6,$7)`,
      [opts.invoices[k - first], cardId, base + (k === 1 ? rest : 0), `Compra (${k}/${opts.n})`,
       opts.date, plan.id, k]);
  }
  return { txId: tx.id as string, planId: plan.id as string };
};

const payInvoice = (invoiceId: string, amount: number, date: string) =>
  q(`insert into transactions(kind, description, amount_cents, payment_method, bank_account_id,
       transaction_date, posted_date, paid_invoice_id, created_by_user_id)
     values ('INVOICE_PAYMENT','Fatura',$1,'PIX',$2,$3,$3,$4,$5)`, [amount, account, date, invoiceId, user]);

beforeEach(async () => {
  db = new PGlite();
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    for (const stmt of readFileSync(join(MIGRATIONS_DIR, f), 'utf8').split('--> statement-breakpoint')) {
      await db.exec(stmt);
    }
  }
  user = (await one(`insert into users(name,email,password_hash) values ('Eduardo','e@x','h') returning id`)).id;
  account = (await one(`insert into bank_accounts(name,is_primary,opening_balance_cents,opening_balance_date)
                        values ('Conta principal',true,500000,'2026-10-01') returning id`)).id;
  cat = (await one(`insert into categories(name,kind) values ('Mercado','EXPENSE') returning id`)).id;
  card = (await one(`insert into credit_cards(name,issuer,limit_total_cents,closing_day,due_day,payment_account_id)
                     values ('Nubank Eduardo','Nubank',500000,3,10,$1) returning id`, [account])).id;
  nov = await newInvoice(card, '2026-11-01', '2026-11-03', '2026-11-10');
  dec = await newInvoice(card, '2026-12-01', '2026-12-03', '2026-12-10');
  jan = await newInvoice(card, '2027-01-01', '2027-01-04', '2027-01-11');
});

describe('constraints do banco', () => {
  it('só uma conta principal', () =>
    rejects(`insert into bank_accounts(name,is_primary,opening_balance_date) values ('X',true,'2026-10-01')`,
      [], /bank_accounts_single_primary/));

  it('reference_month tem de ser o mês do vencimento', () =>
    rejects(`insert into invoices(credit_card_id,reference_month,closing_date,due_date)
             values ($1,'2027-03-01','2027-02-03','2027-02-10')`, [card], /invoices_reference_is_due_month/));

  it('compra no cartão não pode apontar para conta bancária', () =>
    rejects(`insert into transactions(kind,description,amount_cents,payment_method,credit_card_id,bank_account_id,
               category_id,transaction_date,posted_date,created_by_user_id)
             values ('EXPENSE','x',100,'CREDIT_CARD',$1,$2,$3,'2026-10-16','2026-10-16',$4)`,
      [card, account, cat, user], /tx_target/));

  it('valor de transação sempre positivo', () =>
    rejects(`insert into transactions(kind,description,amount_cents,payment_method,bank_account_id,
               category_id,transaction_date,posted_date,created_by_user_id)
             values ('EXPENSE','x',-100,'PIX',$1,$2,'2026-10-16','2026-10-16',$3)`,
      [account, cat, user], /tx_amount_positive/));

  it('parcela duplicada no mesmo plano', async () => {
    const { planId } = await cardPurchase({ total: 10000, n: 3, date: '2026-10-16', invoices: [nov, dec, jan] });
    await rejects(`insert into invoice_items(invoice_id,credit_card_id,kind,amount_cents,description,posting_date,
                     installment_plan_id,installment_number)
                   values ($1,$2,'INSTALLMENT',1,'dup','2026-10-16',$3,1)`, [nov, card, planId], /item_plan_number/);
  });

  it('antecipação: bruto − desconto = pago', async () => {
    const { planId } = await cardPurchase({ total: 10000, n: 3, date: '2026-10-16', invoices: [nov, dec, jan] });
    await rejects(`insert into anticipation_records(installment_plan_id,anticipation_date,installments_count,
                     gross_amount_cents,discount_cents,paid_amount_cents,settlement,target_invoice_id,created_by_user_id)
                   values ($1,'2026-11-12',1,3333,133,3201,'ON_INVOICE',$2,$3)`, [planId, dec, user], /antic_math/);
  });

  it('crédito de estorno é sempre negativo', async () => {
    const { txId, planId } = await cardPurchase({ total: 10000, n: 3, date: '2026-10-16', invoices: [nov, dec, jan] });
    const rr = await one(`insert into refund_records(transaction_id,installment_plan_id,mode,refund_date,amount_cents,
                            target_invoice_id,created_by_user_id)
                          values ($1,$2,'CREDIT_KEEP_INSTALLMENTS','2026-11-20',10000,$3,$4) returning id`,
      [txId, planId, dec, user]);
    await rejects(`insert into invoice_items(invoice_id,credit_card_id,kind,amount_cents,description,posting_date,refund_record_id)
                   values ($1,$2,'REFUND_CREDIT',100,'x','2026-11-20',$3)`, [dec, card, rr.id], /item_refund_shape/);
  });
});

describe('razão do cartão', () => {
  it('parcelamento: arredondamento na 1ª parcela, soma exata', async () => {
    await cardPurchase({ total: 10000, n: 3, date: '2026-10-16', invoices: [nov, dec, jan] });
    expect([await invoiceTotal(nov), await invoiceTotal(dec), await invoiceTotal(jan)]).toEqual([3334, 3333, 3333]);
  });

  it('compra → pagamento → antecipação avulsa → estorno Modo B', async () => {
    const { txId, planId } = await cardPurchase({ total: 10000, n: 3, date: '2026-10-16', invoices: [nov, dec, jan] });
    expect(await availableLimit(card)).toBe(490000);           // total compromete o limite na hora

    await payInvoice(nov, 3334, '2026-11-10');
    expect(await availableLimit(card)).toBe(493334);           // pagamento libera
    expect(await balance(account)).toBe(496666);

    // Antecipa a parcela 3 com R$ 1,33 de desconto, paga avulsa por Pix
    const ptx = await one(`insert into transactions(kind,description,amount_cents,payment_method,bank_account_id,
                             transaction_date,posted_date,created_by_user_id)
                           values ('ANTICIPATION_PAYMENT','Antecipação 3/3',3200,'PIX',$1,'2026-11-12','2026-11-12',$2)
                           returning id`, [account, user]);
    const ar = await one(`insert into anticipation_records(installment_plan_id,anticipation_date,installments_count,
                            gross_amount_cents,discount_cents,paid_amount_cents,settlement,payment_transaction_id,created_by_user_id)
                          values ($1,'2026-11-12',1,3333,133,3200,'DIRECT_PAYMENT',$2,$3) returning id`,
      [planId, ptx.id, user]);
    await q(`update invoice_items set status='ANTICIPATED', anticipation_record_id=$1
             where installment_plan_id=$2 and installment_number=3`, [ar.id, planId]);
    expect(await availableLimit(card)).toBe(496667);           // libera o valor BRUTO da parcela
    expect(await balance(account)).toBe(493466);               // caixa sai o LÍQUIDO

    // Estorno Modo B: cancela a parcela 2 (fatura futura) + crédito da parcela 1 (já paga) em dezembro
    const rr = await one(`insert into refund_records(transaction_id,installment_plan_id,mode,refund_date,amount_cents,
                            target_invoice_id,created_by_user_id)
                          values ($1,$2,'CANCEL_PURCHASE','2026-11-20',3334,$3,$4) returning id`,
      [txId, planId, dec, user]);
    await q(`update invoice_items set status='CANCELLED' where installment_plan_id=$1 and installment_number=2`, [planId]);
    await q(`insert into invoice_items(invoice_id,credit_card_id,kind,amount_cents,description,posting_date,
               refund_record_id,installment_plan_id)
             values ($1,$2,'REFUND_CREDIT',-3334,'Estorno','2026-11-20',$3,$4)`, [dec, card, rr.id, planId]);
    expect(await invoiceTotal(dec)).toBe(-3334);               // fatura de dezembro fica credora
    expect(await availableLimit(card)).toBe(503334);           // saldo credor: limite > total (como no banco)
  });

  it('estorno Modo A: crédito na fatura, parcelas continuam', async () => {
    const { txId, planId } = await cardPurchase({ total: 10000, n: 3, date: '2026-10-16', invoices: [nov, dec, jan] });
    const rr = await one(`insert into refund_records(transaction_id,installment_plan_id,mode,refund_date,amount_cents,
                            target_invoice_id,created_by_user_id)
                          values ($1,$2,'CREDIT_KEEP_INSTALLMENTS','2026-11-20',10000,$3,$4) returning id`,
      [txId, planId, dec, user]);
    await q(`insert into invoice_items(invoice_id,credit_card_id,kind,amount_cents,description,posting_date,refund_record_id,installment_plan_id)
             values ($1,$2,'REFUND_CREDIT',-10000,'Estorno','2026-11-20',$3,$4)`, [dec, card, rr.id, planId]);
    expect(await invoiceTotal(dec)).toBe(3333 - 10000);
    expect(await invoiceTotal(jan)).toBe(3333);                // parcela segue normal
    expect(await availableLimit(card)).toBe(500000);
  });

  it('antecipação na fatura: líquido entra na fatura atual', async () => {
    const { planId } = await cardPurchase({ total: 10000, n: 3, date: '2026-10-16', invoices: [nov, dec, jan] });
    const ar = await one(`insert into anticipation_records(installment_plan_id,anticipation_date,installments_count,
                            gross_amount_cents,discount_cents,paid_amount_cents,settlement,target_invoice_id,created_by_user_id)
                          values ($1,'2026-10-20',2,6666,266,6400,'ON_INVOICE',$2,$3) returning id`, [planId, nov, user]);
    await q(`update invoice_items set status='ANTICIPATED', anticipation_record_id=$1
             where installment_plan_id=$2 and installment_number in (2,3)`, [ar.id, planId]);
    await q(`insert into invoice_items(invoice_id,credit_card_id,kind,amount_cents,description,posting_date,
               anticipation_record_id,installment_plan_id)
             values ($1,$2,'ANTICIPATION',6400,'Antecipação 2-3/3','2026-10-20',$3,$4)`, [nov, card, ar.id, planId]);
    expect(await invoiceTotal(nov)).toBe(3334 + 6400);
    expect(await invoiceTotal(dec)).toBe(0);
    expect(await availableLimit(card)).toBe(500000 - 9734);
  });

  it('parcelamento em andamento (ONBOARDING): só parcelas restantes', async () => {
    // Compra antiga de R$ 1.000 em 10x, começamos a rastrear na parcela 9
    await cardPurchase({ total: 100000, n: 10, firstTracked: 9, date: '2026-03-05',
                         invoices: [nov, dec], source: 'ONBOARDING' });
    expect(await availableLimit(card)).toBe(500000 - 20000);
    expect(await grossSpend('2026-03-01')).toBe(0);            // não polui meses anteriores ao uso
    await rejects(`update installment_plans set first_tracked_installment = 11`, [], /plan_first_tracked/);
  });

  it('cartão adicional de outro titular sem limite rastreado', async () => {
    const add = (await one(`insert into credit_cards(name,issuer,is_additional,holder_name,closing_day,due_day,payment_account_id)
                            values ('Nubank adicional','Nubank',true,'Mãe',3,10,$1) returning id`, [account])).id;
    const inv = await newInvoice(add, '2026-11-01', '2026-11-03', '2026-11-10');
    await cardPurchase({ total: 5000, n: 1, date: '2026-10-16', invoices: [inv], cardId: add });
    expect(await availableLimit(add)).toBeNull();
    expect(await invoiceTotal(inv)).toBe(5000);
    await rejects(`insert into credit_cards(name,is_additional,closing_day,due_day,payment_account_id)
                   values ('x',true,3,10,$1)`, [account], /credit_cards_additional_holder/);
  });
});

describe('Gasto Bruto', () => {
  it('estorno reduz o mês do estorno; mês da compra fica intacto', async () => {
    const { txId, planId } = await cardPurchase({ total: 120000, n: 12, date: '2026-10-16',
      invoices: [nov, dec, jan, ...(await Promise.all(Array.from({ length: 9 }, (_, i) => {
        const y = 2027, m = i + 2;
        const mm = String(m).padStart(2, '0');
        return newInvoice(card, `${y}-${mm}-01`, `${y}-${mm}-03`, `${y}-${mm}-10`);
      })))] });
    expect(await grossSpend('2026-10-01')).toBe(120000);       // valor cheio no mês da compra
    expect(await grossSpend('2026-11-01')).toBe(0);
    await q(`insert into refund_records(transaction_id,installment_plan_id,mode,refund_date,amount_cents,
               target_invoice_id,created_by_user_id)
             values ($1,$2,'CREDIT_KEEP_INSTALLMENTS','2026-11-20',30000,$3,$4)`, [txId, planId, dec, user]);
    expect(await grossSpend('2026-10-01')).toBe(120000);       // histórico preservado
    expect(await grossSpend('2026-11-01')).toBe(-30000);       // estorno abate novembro
  });
});
