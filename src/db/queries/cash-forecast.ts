/**
 * Previsto dia a dia (D94): os movimentos que mexem no saldo da conta principal, de `from` a `to`, para
 * domain/reports/cash-forecast montar os dias. As regras de cada parte são as MESMAS do resumo de caixa
 * (reports.ts: projectedEndOfCurrentMonth e projection), então o fim de cada mês bate com o card da Início, com a
 * Projeção e com o bot (teste de aceitação tests/acceptance/cash-forecast.test.ts).
 *
 * - Até hoje: lançamentos pagos da conta principal (todos os tipos, como getAccountBalance).
 * - De hoje em diante: pendentes (atrasados caem hoje), agendados, o que falta pagar das faturas e, nos meses
 *   depois do atual, os fixos/recorrentes e as assinaturas no cartão (em memória, nunca gravados).
 */
import { inArray, sql } from 'drizzle-orm';
import { purchaseDueDates } from '@/domain/card/store-credit';
import { addDays, addMonths, compareDates, monthEnd, monthStart, type ISODate } from '@/domain/dates';
import type { Cents } from '@/domain/money';
import {
  buildDays,
  flowDate,
  isOverdue,
  type CashFlow,
  type ForecastDay,
} from '@/domain/reports/cash-forecast';
import { projectedItems, subscriptionCashDate } from '@/domain/reports/projection';
import { centsFromDb } from '@/server/context';
import type { AnyDB } from '../client';
import { creditCards, recurringTemplates } from '../schema';
import { getPrimaryAccount } from './accounts';
import { getAccountBalance } from './balance';
import { invoiceRows, listCardSummaries } from './cards';
import { loadProjectionTemplates, rows } from './reports';

/** Parcelas que a simulação de compra no cartão oferece. */
export const MAX_SIMULATED_INSTALLMENTS = 12;

const IN_KINDS = new Set(['INCOME', 'TRANSFER_IN', 'ADJUSTMENT_IN']);
const OUT_KINDS_SQL = sql`('EXPENSE', 'INVOICE_PAYMENT', 'ANTICIPATION_PAYMENT')`;

const REALIZED_DETAIL: Record<string, string> = {
  INVOICE_PAYMENT: 'Pagamento de fatura',
  ANTICIPATION_PAYMENT: 'Antecipação',
  TRANSFER_IN: 'Transferência',
  TRANSFER_OUT: 'Transferência',
  ADJUSTMENT_IN: 'Acerto de saldo',
  ADJUSTMENT_OUT: 'Acerto de saldo',
};

type EntryRaw = {
  id: string;
  kind: string;
  description: string;
  amount: string;
  date: string;
  category: string | null;
  loan_installment: number | null;
  loan_or_funding: boolean;
};

/** Pagos da conta principal com data de `from` a `upTo` (o saldo real de cada dia). */
async function realizedFlows(
  db: AnyDB,
  accountId: string,
  from: ISODate,
  upTo: ISODate,
): Promise<CashFlow[]> {
  const r = await rows<EntryRaw>(
    db,
    sql`select t.id, t.kind, t.description, t.amount_cents as amount, t.posted_date::text as date,
               c.name as category, t.loan_installment_number as loan_installment,
               (t.loan_id is not null or t.funding_for_transaction_id is not null) as loan_or_funding
        from transactions t
        left join categories c on c.id = t.category_id
        where t.bank_account_id = ${accountId} and t.status = 'POSTED' and t.deleted_at is null
          and t.posted_date between ${from} and ${upTo}`,
  );
  return r.map((x) => {
    const cents = centsFromDb(x.amount);
    return {
      key: `t-${x.id}`,
      date: x.date,
      originalDate: x.date,
      amountCents: IN_KINDS.has(x.kind) ? cents : -cents,
      source: 'REALIZED',
      overdue: false,
      label: x.description,
      detail: x.loan_or_funding ? 'Empréstimo ou aporte' : (REALIZED_DETAIL[x.kind] ?? x.category),
      href: `/lancamentos/${x.id}`,
    };
  });
}

/**
 * Pendentes que vencem até `to` (os atrasados de qualquer época caem hoje): mesma regra de pendingAccount, com as
 * parcelas de empréstimo marcadas à parte.
 */
async function pendingFlows(db: AnyDB, today: ISODate, to: ISODate): Promise<CashFlow[]> {
  const r = await rows<EntryRaw>(
    db,
    sql`select t.id, t.kind, t.description, t.amount_cents as amount, t.due_date::text as date,
               c.name as category, t.loan_installment_number as loan_installment, false as loan_or_funding
        from transactions t
        left join categories c on c.id = t.category_id
        where t.kind in ('INCOME', 'EXPENSE') and t.status = 'PENDING' and t.deleted_at is null
          and t.bank_account_id is not null
          and not (t.kind = 'INCOME' and (t.loan_id is not null or t.funding_for_transaction_id is not null))
          and t.due_date <= ${to}`,
  );
  return r.map((x) => {
    const cents = centsFromDb(x.amount);
    const loan = x.loan_installment !== null;
    return {
      key: `t-${x.id}`,
      date: flowDate(x.date, today),
      originalDate: x.date,
      amountCents: x.kind === 'INCOME' ? cents : -cents,
      source: loan ? 'LOAN' : 'PENDING',
      overdue: isOverdue(x.date, today),
      label: x.description,
      detail: loan ? `Empréstimo · parcela ${x.loan_installment}` : x.category,
      href: `/lancamentos/${x.id}`,
    };
  });
}

/** Agendados (D67): pagos com data depois de hoje, até `to`. Mesma regra de scheduledAccount. */
async function scheduledFlows(db: AnyDB, today: ISODate, to: ISODate): Promise<CashFlow[]> {
  const r = await rows<EntryRaw>(
    db,
    sql`select t.id, t.kind, t.description, t.amount_cents as amount, t.posted_date::text as date,
               c.name as category, t.loan_installment_number as loan_installment, false as loan_or_funding
        from transactions t
        left join categories c on c.id = t.category_id
        where t.status = 'POSTED' and t.deleted_at is null and t.bank_account_id is not null
          and (t.kind in ${OUT_KINDS_SQL}
               or (t.kind = 'INCOME' and t.loan_id is null and t.funding_for_transaction_id is null))
          and t.posted_date > ${today} and t.posted_date <= ${to}`,
  );
  return r.map((x) => {
    const cents = centsFromDb(x.amount);
    return {
      key: `t-${x.id}`,
      date: x.date,
      originalDate: x.date,
      amountCents: x.kind === 'INCOME' ? cents : -cents,
      source: 'SCHEDULED',
      overdue: false,
      label: x.description,
      detail: REALIZED_DETAIL[x.kind] ?? x.category,
      href: `/lancamentos/${x.id}`,
    };
  });
}

/** O que falta pagar de cada fatura que vence até `to` (mesma regra de invoicesRemaining). */
async function invoiceFlows(db: AnyDB, today: ISODate, to: ISODate): Promise<CashFlow[]> {
  const r = await rows<{
    id: string;
    card_name: string;
    due_date: string;
    closing_date: string;
    remaining: string;
  }>(
    db,
    sql`select v.id, c.name as card_name, v.due_date::text as due_date, v.closing_date::text as closing_date,
               greatest(0, tot.total - coalesce(pay.paid, 0)) as remaining
        from invoices v
        join credit_cards c on c.id = v.credit_card_id
        join (select invoice_id, sum(amount_cents) total from invoice_items where status = 'ACTIVE' group by invoice_id) tot
          on tot.invoice_id = v.id
        left join (select paid_invoice_id, sum(amount_cents) paid from transactions
                   where kind = 'INVOICE_PAYMENT' and status = 'POSTED' and deleted_at is null group by paid_invoice_id) pay
          on pay.paid_invoice_id = v.id
        where v.due_date <= ${to} and greatest(0, tot.total - coalesce(pay.paid, 0)) > 0`,
  );
  return r.map((x) => {
    const closed = compareDates(x.closing_date, today) <= 0;
    return {
      key: `i-${x.id}`,
      date: flowDate(x.due_date, today),
      originalDate: x.due_date,
      amountCents: -centsFromDb(x.remaining),
      source: 'INVOICE',
      overdue: isOverdue(x.due_date, today),
      label: `Fatura ${x.card_name}`,
      detail: closed
        ? 'Fechada'
        : `Aberta · fecha em ${x.closing_date.slice(8)}/${x.closing_date.slice(5, 7)}`,
      href: `/cartoes/faturas/${x.id}`,
    };
  });
}

/** Fixos, recorrentes e assinaturas dos meses depois do atual até `to` (mesmos itens de projectMonth). */
async function templateFlows(db: AnyDB, today: ISODate, to: ISODate): Promise<CashFlow[]> {
  const templates = await loadProjectionTemplates(db);
  if (templates.length === 0) return [];
  const names = await db
    .select({
      id: recurringTemplates.id,
      description: recurringTemplates.description,
      card: creditCards.name,
    })
    .from(recurringTemplates)
    .leftJoin(creditCards, sql`${creditCards.id} = ${recurringTemplates.creditCardId}`)
    .where(
      inArray(
        recurringTemplates.id,
        templates.map((t) => t.id),
      ),
    );
  const out: CashFlow[] = [];
  for (let m = addMonths(monthStart(today), 1); compareDates(m, to) <= 0; m = addMonths(m, 1)) {
    for (const it of projectedItems(templates, m, today)) {
      const t = templates.find((x) => x.id === it.templateId)!;
      const name = names.find((n) => n.id === it.templateId);
      const sign = it.direction === 'INCOME' ? 1 : -1;
      const date = it.subscription ? subscriptionCashDate(t, it.dueDate, m) : it.dueDate;
      if (compareDates(date, to) > 0) continue; // só por segurança: projectedItems já é do mês m ≤ to
      out.push({
        key: `p-${it.templateId}-${it.dueDate}`,
        date,
        originalDate: it.dueDate,
        amountCents: sign * it.amountCents,
        source: it.subscription ? 'SUBSCRIPTION' : it.type === 'FIXED' ? 'FIXED' : 'VARIABLE',
        overdue: false,
        label: name?.description ?? 'Fixo',
        detail: it.subscription
          ? `Assinatura · ${name?.card ?? 'cartão'}`
          : it.type === 'FIXED'
            ? 'Fixo · previsto'
            : 'Recorrente · estimado',
        href: `/fixos/${it.templateId}`,
      });
    }
  }
  return out;
}

export type ForecastCard = {
  id: string;
  name: string;
  isAdditional: boolean;
  /** null = limite não rastreado */
  availableCents: Cents | null;
  /** vencimento da fatura de cada parcela de uma compra feita hoje (1ª…12ª) */
  dueDates: ISODate[];
};

/** Cartões ativos com a fatura em que cai uma compra feita hoje (mesma alocação de invoicesForPurchase). */
async function forecastCards(db: AnyDB, today: ISODate): Promise<ForecastCard[]> {
  const summaries = await listCardSummaries(db, today);
  if (summaries.length === 0) return [];
  const invs = await invoiceRows(
    db,
    summaries.map((s) => s.card.id),
  );
  return summaries.map((s) => {
    const mine = invs.filter((i) => i.cardId === s.card.id);
    return {
      id: s.card.id,
      name: s.card.name,
      isAdditional: s.card.isAdditional,
      availableCents: s.limitTotalCents === null ? null : s.availableCents,
      dueDates: purchaseDueDates(s.card, today, mine, MAX_SIMULATED_INSTALLMENTS),
    };
  });
}

export type CashForecastData = {
  accountName: string;
  today: ISODate;
  from: ISODate;
  to: ISODate;
  days: ForecastDay[];
  cards: ForecastCard[];
};

/**
 * Os dias de `from` a `to` (o 1º dia de um mês até o último de outro). Mês que já passou: só o saldo real.
 * Se o intervalo chega a hoje ou depois, `from` não pode estar depois do mês atual: o previsto de um mês futuro
 * parte do saldo real de hoje.
 */
export async function cashForecast(
  db: AnyDB,
  today: ISODate,
  from: ISODate,
  to: ISODate,
): Promise<CashForecastData | null> {
  const account = await getPrimaryAccount(db);
  if (!account) return null;
  const future = compareDates(to, today) >= 0;
  if (future && compareDates(from, monthStart(today)) > 0) {
    throw new Error('O previsto de um mês futuro começa no mês atual.');
  }
  const upTo = future ? today : to;
  const [opening, realized, pending, scheduled, invoiceItems, templates, cards] = await Promise.all([
    getAccountBalance(db, account.id, addDays(from, -1)),
    realizedFlows(db, account.id, from, upTo),
    future ? pendingFlows(db, today, to) : [],
    future ? scheduledFlows(db, today, to) : [],
    future ? invoiceFlows(db, today, to) : [],
    future ? templateFlows(db, today, to) : [],
    future ? forecastCards(db, today) : [],
  ]);
  const days = buildDays(from, to, opening, [
    ...realized,
    ...pending,
    ...scheduled,
    ...invoiceItems,
    ...templates,
  ]);
  return { accountName: account.name, today, from, to, days, cards };
}

/** Intervalo do previsto para a tela de um mês: do mês (passado) ou do mês atual até max(mês, atual + `ahead`). */
export function forecastRange(month: ISODate, today: ISODate, ahead: number): { from: ISODate; to: ISODate } {
  const current = monthStart(today);
  const m = monthStart(month);
  if (compareDates(m, current) < 0) return { from: m, to: monthEnd(m) };
  const last = addMonths(current, ahead);
  return { from: current, to: monthEnd(compareDates(m, last) > 0 ? m : last) };
}
