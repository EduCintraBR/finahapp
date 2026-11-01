/**
 * Fórmulas canônicas (CLAUDE.md, SPEC §5) em SQL — Gasto Bruto, Gasto Mensal, economia com
 * antecipação, resumo de caixa da Home (D38) e projeção (D39–D41).
 * As referências estão em tests/acceptance/card-ledger.test.ts; tests/acceptance/reports.test.ts
 * confere estes números com elas.
 *
 * SQL escrito à mão com aliases explícitos (ver CLAUDE.md sobre subconsultas no Drizzle).
 */
import { asc, eq, isNull } from 'drizzle-orm';
import { sql, type SQL } from 'drizzle-orm';
import { addDays, addMonths, compareDates, monthEnd, monthStart, type ISODate } from '@/domain/dates';
import { overdueCutoff } from '@/domain/account/rules';
import { cardRule } from '@/domain/card/invoices';
import type { Cents } from '@/domain/money';
import {
  accumulate,
  projectMonth,
  type MonthProjection,
  type ProjectionTemplate,
} from '@/domain/reports/projection';
import { centsFromDb } from '@/server/context';
import type { AnyDB } from '../client';
import { getPrimaryAccount } from './accounts';
import { getAccountBalance } from './balance';
import { creditCards, invoices, recurringTemplates } from '../schema';

export type ReportFilters = {
  /** quem lançou */
  createdBy?: string | undefined;
  /** de quem é: id do usuário ou 'casal' (sem beneficiário) */
  beneficiary?: string | undefined;
  categoryId?: string | undefined;
  cardId?: string | undefined;
  paymentMethod?: string | undefined;
};

type Key = 'category' | 'month';
/** chave do agrupamento: categoria, ou mês 'YYYY-MM-01' */
export type Totals = Map<string, Cents>;
export const ADJUSTMENTS_KEY = 'ajustes';
export const NO_CATEGORY_KEY = 'sem-categoria';

async function rows<T>(db: AnyDB, q: SQL): Promise<T[]> {
  const r = (await db.execute(q)) as unknown;
  return (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];
}

/** Data do Gasto Mensal (caixa) de uma despesa da conta: vencimento (ou à vista); parcela de empréstimo paga, a data do pagamento. */
const CASH_DATE_SQL = `case when t.loan_installment_number is not null and t.status = 'POSTED' then t.posted_date else coalesce(t.due_date, t.posted_date) end`;

/** Filtros de pessoa/categoria sobre a transação `alias` (a compra ou o lançamento). */
function personFilters(f: ReportFilters, alias: string): SQL {
  const a = sql.raw(alias);
  const parts: SQL[] = [];
  if (f.createdBy) parts.push(sql` and ${a}.created_by_user_id = ${f.createdBy}`);
  if (f.beneficiary === 'casal') parts.push(sql` and ${a}.beneficiary_user_id is null`);
  else if (f.beneficiary) parts.push(sql` and ${a}.beneficiary_user_id = ${f.beneficiary}`);
  if (f.categoryId) parts.push(sql` and ${a}.category_id = ${f.categoryId}`);
  return sql.join(parts, sql``);
}

/** Lado conta (Pix, débito…) — some se o filtro for de cartão. */
function accountSide(f: ReportFilters, alias: string): SQL {
  if (f.cardId || f.paymentMethod === 'CREDIT_CARD') return sql` and false`;
  return f.paymentMethod ? sql` and ${sql.raw(alias)}.payment_method = ${f.paymentMethod}` : sql``;
}

/** Lado cartão — some se o filtro for de meio de pagamento da conta. */
function cardSide(f: ReportFilters, cardColumn: string): SQL {
  if (f.paymentMethod && f.paymentMethod !== 'CREDIT_CARD') return sql` and false`;
  return f.cardId ? sql` and ${sql.raw(cardColumn)} = ${f.cardId}` : sql``;
}

const keyExpr = (key: Key, categoryCol: string, dateCol: string) =>
  key === 'category'
    ? sql.raw(`coalesce(${categoryCol}::text, '${NO_CATEGORY_KEY}')`)
    : sql.raw(`to_char(date_trunc('month', ${dateCol}), 'YYYY-MM-DD')`);

function add(into: Totals, list: { k: string; v: string | number }[], sign = 1) {
  for (const r of list) into.set(r.k, (into.get(r.k) ?? 0) + sign * centsFromDb(r.v));
}

const anyFilter = (f: ReportFilters) => Boolean(f.createdBy || f.beneficiary || f.categoryId);

/**
 * Gasto Bruto (competência): Σ EXPENSE (conta + cartão) por transaction_date − Σ estornos por
 * refund_date, sem ONBOARDING. Estorno abate na categoria da compra estornada (D42).
 */
export async function grossSpend(
  db: AnyDB,
  from: ISODate,
  to: ISODate,
  key: Key,
  f: ReportFilters = {},
): Promise<Totals> {
  const sideFilter = sql`${
    f.cardId || f.paymentMethod === 'CREDIT_CARD'
      ? sql` and t.credit_card_id is not null`
      : f.paymentMethod
        ? sql` and t.payment_method = ${f.paymentMethod}`
        : sql``
  }${f.cardId ? sql` and t.credit_card_id = ${f.cardId}` : sql``}`;
  const purchases = await rows<{ k: string; v: string }>(
    db,
    sql`select ${keyExpr(key, 't.category_id', 't.transaction_date')} as k, sum(t.amount_cents) as v
        from transactions t
        where t.kind = 'EXPENSE' and t.status not in ('CANCELLED', 'ANTICIPATED') and t.deleted_at is null and t.source <> 'ONBOARDING'
          and t.transaction_date between ${from} and ${to}${personFilters(f, 't')}${sideFilter}
        group by 1`,
  );
  const refunds = await rows<{ k: string; v: string }>(
    db,
    sql`select ${keyExpr(key, 't.category_id', 'r.refund_date')} as k, sum(r.amount_cents) as v
        from refund_records r join transactions t on t.id = r.transaction_id
        where r.refund_date between ${from} and ${to}${personFilters(f, 't')}${sideFilter}
        group by 1`,
  );
  const out: Totals = new Map();
  add(out, purchases);
  add(out, refunds, -1);
  return out;
}

/**
 * Gasto Mensal (caixa): despesas da conta (due_date, ou posted_date se à vista) + gastos do cartão de benefícios
 * (data do gasto) + itens ACTIVE das faturas que vencem no período + antecipações pagas avulsas.
 * INVOICE_PAYMENT nunca entra.
 */
export async function monthlySpend(
  db: AnyDB,
  from: ISODate,
  to: ISODate,
  key: Key,
  f: ReportFilters = {},
): Promise<Totals> {
  // parcela de empréstimo já paga (D66) conta na data do pagamento; as demais, no vencimento (ou à vista)
  const cashDate = sql.raw(CASH_DATE_SQL);
  const account = await rows<{ k: string; v: string }>(
    db,
    sql`select ${keyExpr(key, 't.category_id', CASH_DATE_SQL)} as k, sum(t.amount_cents) as v
        from transactions t
        where t.kind = 'EXPENSE' and t.bank_account_id is not null and t.status not in ('CANCELLED', 'ANTICIPATED') and t.deleted_at is null
          and ${cashDate} between ${from} and ${to}${personFilters(f, 't')}${accountSide(f, 't')}
        group by 1`,
  );
  // gastos no cartão de benefícios (D65): saem do saldo da carteira na data do gasto
  const benefit = await rows<{ k: string; v: string }>(
    db,
    sql`select ${keyExpr(key, 't.category_id', 't.posted_date')} as k, sum(t.amount_cents) as v
        from transactions t
        where t.kind = 'EXPENSE' and t.benefit_wallet_id is not null and t.status = 'POSTED' and t.deleted_at is null
          and t.posted_date between ${from} and ${to}${personFilters(f, 't')}${accountSide(f, 't')}
        group by 1`,
  );
  const items = await rows<{ k: string; v: string }>(
    db,
    sql`select ${
      key === 'category'
        ? sql.raw(
            `case when i.installment_plan_id is null then '${ADJUSTMENTS_KEY}' else coalesce(t.category_id::text, '${NO_CATEGORY_KEY}') end`,
          )
        : sql.raw(`to_char(date_trunc('month', v.due_date), 'YYYY-MM-DD')`)
    } as k, sum(i.amount_cents) as v
        from invoice_items i
        join invoices v on v.id = i.invoice_id
        left join installment_plans p on p.id = i.installment_plan_id
        left join transactions t on t.id = p.transaction_id
        where i.status = 'ACTIVE' and v.due_date between ${from} and ${to}
          ${anyFilter(f) ? sql`and t.id is not null` : sql``}${personFilters(f, 't')}${cardSide(f, 'i.credit_card_id')}
        group by 1`,
  );
  const anticipations = await rows<{ k: string; v: string }>(
    db,
    sql`select ${keyExpr(key, 't.category_id', 'a.posted_date')} as k, sum(a.amount_cents) as v
        from transactions a
        join anticipation_records ar on ar.payment_transaction_id = a.id
        join installment_plans p on p.id = ar.installment_plan_id
        join transactions t on t.id = p.transaction_id
        where a.kind = 'ANTICIPATION_PAYMENT' and a.status = 'POSTED' and a.deleted_at is null
          and a.posted_date between ${from} and ${to}${personFilters(f, 't')}${cardSide(f, 'p.credit_card_id')}
        group by 1`,
  );
  const out: Totals = new Map();
  add(out, account);
  add(out, benefit);
  add(out, items);
  add(out, anticipations);
  return out;
}

/** "Economia com antecipação" = Σ descontos das antecipações no período (por data da antecipação). */
export async function anticipationSavings(
  db: AnyDB,
  from: ISODate,
  to: ISODate,
  f: ReportFilters = {},
): Promise<Cents> {
  const [r] = await rows<{ v: string | null }>(
    db,
    sql`select sum(ar.discount_cents) as v
        from anticipation_records ar
        join installment_plans p on p.id = ar.installment_plan_id
        join transactions t on t.id = p.transaction_id
        where ar.anticipation_date between ${from} and ${to}${personFilters(f, 't')}${cardSide(f, 'p.credit_card_id')}`,
  );
  return centsFromDb(r?.v);
}

export const total = (t: Totals): Cents => [...t.values()].reduce((s, v) => s + v, 0);

// ─────────── resumo de caixa da Home (D38) ───────────

export type CashSummary = {
  balanceCents: Cents;
  incomeReceivedCents: Cents;
  incomePendingCents: Cents;
  outPaidCents: Cents;
  outPendingCents: Cents;
  /** Saídas (U4): o que já saiu + o que ainda vai sair no mês (pendente, atrasado e agendado; D72) */
  outTotalCents: Cents;
  /** saldo no fim do mês: projetado (mês atual), real (passado) ou estimado (futuro, D40) */
  endOfMonthCents: Cents;
  endOfMonthKind: 'projected' | 'actual' | 'estimated';
};

/**
 * Vencimento na janela de um mês (D72): até `to` e, com `from`, a partir dele **ou** antes de `overdueBefore`
 * (atrasado de antes que continua sem baixa). Mesma regra de pendingCountsInMonth. `from` null = tudo até `to`.
 */
function dueWindow(col: SQL, from: ISODate | null, to: ISODate, overdueBefore: ISODate | null): SQL {
  if (!from) return sql`${col} <= ${to}`;
  return overdueBefore
    ? sql`${col} <= ${to} and (${col} >= ${from} or ${col} < ${overdueBefore})`
    : sql`${col} between ${from} and ${to}`;
}

/** O que falta pagar das faturas com vencimento na janela (Σ max(0, total − pago) por fatura). */
async function invoicesRemaining(
  db: AnyDB,
  from: ISODate | null,
  to: ISODate,
  overdueBefore: ISODate | null = null,
): Promise<Cents> {
  const [r] = await rows<{ v: string | null }>(
    db,
    sql`select sum(greatest(0, tot.total - coalesce(pay.paid, 0))) as v
        from invoices v
        join credit_cards c on c.id = v.credit_card_id
        join (select invoice_id, sum(amount_cents) total from invoice_items where status = 'ACTIVE' group by invoice_id) tot
          on tot.invoice_id = v.id
        left join (select paid_invoice_id, sum(amount_cents) paid from transactions
                   where kind = 'INVOICE_PAYMENT' and status = 'POSTED' and deleted_at is null group by paid_invoice_id) pay
          on pay.paid_invoice_id = v.id
        where ${dueWindow(sql`v.due_date`, from, to, overdueBefore)}`,
  );
  return centsFromDb(r?.v);
}

/** Pendentes da conta por direção (due_date na janela; ver dueWindow). */
async function pendingAccount(
  db: AnyDB,
  kind: 'INCOME' | 'EXPENSE',
  from: ISODate | null,
  to: ISODate,
  overdueBefore: ISODate | null = null,
): Promise<Cents> {
  const [r] = await rows<{ v: string | null }>(
    db,
    sql`select sum(t.amount_cents) as v from transactions t
        where t.kind = ${kind} and t.status = 'PENDING' and t.deleted_at is null and t.bank_account_id is not null
          and not (t.kind = 'INCOME' and (t.loan_id is not null or t.funding_for_transaction_id is not null))
          and ${dueWindow(sql`t.due_date`, from, to, overdueBefore)}`,
  );
  return centsFromDb(r?.v);
}

/**
 * Já aconteceu: pago com data de `from` até `to` (limitada a hoje, D67). O que está pago mas com data depois de hoje
 * é agendado (ver scheduledAccount) e ainda não saiu nem entrou na conta.
 */
async function postedAccount(
  db: AnyDB,
  kinds: string[],
  from: ISODate,
  to: ISODate,
  today: ISODate,
): Promise<Cents> {
  const upTo = compareDates(to, today) > 0 ? today : to;
  const [r] = await rows<{ v: string | null }>(
    db,
    sql`select sum(t.amount_cents) as v from transactions t
        where t.kind in (${sql.join(
          kinds.map((k) => sql`${k}`),
          sql`, `,
        )}) and t.status = 'POSTED' and t.deleted_at is null and t.bank_account_id is not null
          and not (t.kind = 'INCOME' and (t.loan_id is not null or t.funding_for_transaction_id is not null))
          and t.posted_date between ${from} and ${upTo}`,
  );
  return centsFromDb(r?.v);
}

/** Agendado (D67): pago, com data DEPOIS de hoje, até `to`. Soma ao "a receber"/"a pagar" e à previsão do saldo. */
async function scheduledAccount(
  db: AnyDB,
  kinds: string[],
  from: ISODate,
  to: ISODate,
  today: ISODate,
): Promise<Cents> {
  const start = compareDates(from, today) > 0 ? from : addDays(today, 1);
  if (compareDates(start, to) > 0) return 0;
  const [r] = await rows<{ v: string | null }>(
    db,
    sql`select sum(t.amount_cents) as v from transactions t
        where t.kind in (${sql.join(
          kinds.map((k) => sql`${k}`),
          sql`, `,
        )}) and t.status = 'POSTED' and t.deleted_at is null and t.bank_account_id is not null
          and not (t.kind = 'INCOME' and (t.loan_id is not null or t.funding_for_transaction_id is not null))
          and t.posted_date between ${start} and ${to}`,
  );
  return centsFromDb(r?.v);
}

const OUT_KINDS = ['EXPENSE', 'INVOICE_PAYMENT', 'ANTICIPATION_PAYMENT'];

/** Parcelas de empréstimo ainda pendentes que vencem no intervalo (D66): meses futuros da projeção. */
async function loanInstallmentsDue(db: AnyDB, from: ISODate, to: ISODate): Promise<Cents> {
  const [r] = await rows<{ v: string | null }>(
    db,
    sql`select sum(t.amount_cents) as v from transactions t
        where t.loan_installment_number is not null and t.status = 'PENDING' and t.deleted_at is null
          and t.due_date between ${from} and ${to}`,
  );
  return centsFromDb(r?.v);
}

/** Saldo projetado no fim do mês atual (D38): saldo + receitas pendentes − saídas pendentes (com atrasados). */
export async function projectedEndOfCurrentMonth(db: AnyDB, balance: Cents, today: ISODate): Promise<Cents> {
  const end = monthEnd(today);
  const [inc, exp, inv, schedIn, schedOut] = await Promise.all([
    pendingAccount(db, 'INCOME', null, end),
    pendingAccount(db, 'EXPENSE', null, end),
    invoicesRemaining(db, null, end),
    scheduledAccount(db, ['INCOME'], today, end, today),
    scheduledAccount(db, OUT_KINDS, today, end, today),
  ]);
  return balance + inc + schedIn - exp - inv - schedOut;
}

export async function cashSummary(db: AnyDB, month: ISODate, today: ISODate): Promise<CashSummary | null> {
  const account = await getPrimaryAccount(db);
  if (!account) return null;
  const from = monthStart(month);
  const to = monthEnd(month);
  // D72: o atrasado de antes acompanha o mês até a baixa (no mês atual e nos passados = tudo até o fim do mês)
  const overdueBefore = overdueCutoff(month, today);
  const [
    balanceCents,
    incomeReceivedCents,
    pendingInc,
    outPaidCents,
    pendingExp,
    pendingInv,
    schedIn,
    schedOut,
  ] = await Promise.all([
    getAccountBalance(db, account.id, today),
    postedAccount(db, ['INCOME'], from, to, today),
    pendingAccount(db, 'INCOME', from, to, overdueBefore),
    postedAccount(db, OUT_KINDS, from, to, today),
    pendingAccount(db, 'EXPENSE', from, to, overdueBefore),
    invoicesRemaining(db, from, to, overdueBefore),
    scheduledAccount(db, ['INCOME'], from, to, today),
    scheduledAccount(db, OUT_KINDS, from, to, today),
  ]);
  const current = monthStart(today);
  let endOfMonthCents: Cents;
  let endOfMonthKind: CashSummary['endOfMonthKind'];
  // a receber = pendentes + agendados (D67); mês futuro soma também o que os fixos vão gerar (D68)
  let incomePendingCents = pendingInc + schedIn;
  let templatesOutCents = 0;
  if (from === current) {
    endOfMonthCents = await projectedEndOfCurrentMonth(db, balanceCents, today);
    endOfMonthKind = 'projected';
  } else if (compareDates(from, current) < 0) {
    endOfMonthCents = await getAccountBalance(db, account.id, to);
    endOfMonthKind = 'actual';
  } else {
    // ocorrências de meses futuros não são gravadas (CLAUDE.md): vêm da projeção, da mesma conta que o saldo estimado
    const range = await projection(db, today, from);
    const row = range.at(-1)!;
    endOfMonthCents = row.estimatedBalanceCents;
    endOfMonthKind = 'estimated';
    incomePendingCents += row.templateIncomeCents;
    templatesOutCents = row.fixedCents + row.variableCents + row.subscriptionsCents;
  }
  const outPendingCents = pendingExp + pendingInv + schedOut + templatesOutCents;
  return {
    balanceCents,
    incomeReceivedCents,
    incomePendingCents,
    outPaidCents,
    outPendingCents,
    outTotalCents: outPaidCents + outPendingCents,
    endOfMonthCents,
    endOfMonthKind,
  };
}

// ─────────── projeção (D39–D41) ───────────

export type ProjectionRow = MonthProjection & { estimatedBalanceCents: Cents };

/** Fixos e recorrentes ativos no formato da projeção (D68: também alimenta o detalhe dos cards da Home). */
export async function loadProjectionTemplates(db: AnyDB): Promise<ProjectionTemplate[]> {
  const [tpls, cards, mats] = await Promise.all([
    db.select().from(recurringTemplates).where(eq(recurringTemplates.isActive, true)),
    db.select().from(creditCards).where(isNull(creditCards.archivedAt)),
    db
      .select({
        cardId: invoices.creditCardId,
        referenceMonth: invoices.referenceMonth,
        closingDate: invoices.closingDate,
        dueDate: invoices.dueDate,
      })
      .from(invoices)
      .orderBy(asc(invoices.referenceMonth)),
  ]);
  const templates: ProjectionTemplate[] = tpls.flatMap((t) => {
    const card = t.creditCardId ? cards.find((c) => c.id === t.creditCardId) : null;
    if (t.creditCardId && !card) return []; // cartão arquivado
    return [
      {
        id: t.id,
        direction: t.direction,
        type: t.type,
        amountCents: t.expectedAmountCents,
        dayOfMonth: t.dayOfMonth,
        startMonth: t.startMonth,
        endMonth: t.endMonth,
        isActive: t.isActive,
        paymentMethod: t.paymentMethod,
        card: card
          ? {
              rule: cardRule(card),
              invoices: mats.filter((m) => m.cardId === card.id),
            }
          : null,
      },
    ];
  });

  return templates;
}

/** Meses do mês seguinte ao atual até `untilMonth`, com o saldo estimado acumulado (D40). */
export async function projection(db: AnyDB, today: ISODate, untilMonth: ISODate): Promise<ProjectionRow[]> {
  const account = await getPrimaryAccount(db);
  if (!account) return [];
  const balance = await getAccountBalance(db, account.id, today);
  const start = await projectedEndOfCurrentMonth(db, balance, today);

  const templates = await loadProjectionTemplates(db);

  const months: ISODate[] = [];
  for (
    let m = addMonths(monthStart(today), 1);
    compareDates(m, monthStart(untilMonth)) <= 0;
    m = addMonths(m, 1)
  ) {
    months.push(m);
  }
  const results: MonthProjection[] = [];
  for (const m of months) {
    const [invoicesDueCents, loansDueCents, scheduledInCents, scheduledOutCents] = await Promise.all([
      invoicesRemaining(db, m, monthEnd(m)),
      loanInstallmentsDue(db, m, monthEnd(m)),
      scheduledAccount(db, ['INCOME'], m, monthEnd(m), today),
      scheduledAccount(db, OUT_KINDS, m, monthEnd(m), today),
    ]);
    results.push(
      projectMonth({
        month: m,
        today,
        templates,
        invoicesDueCents,
        loansDueCents,
        scheduledInCents,
        scheduledOutCents,
      }),
    );
  }
  const balances = accumulate(
    start,
    results.map((r) => r.resultCents),
  );
  return results.map((r, i) => ({ ...r, estimatedBalanceCents: balances[i]! }));
}
