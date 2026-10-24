/**
 * Detalhe dos quatro cards da Home (D68): Entrou, Saiu, A receber, A pagar.
 * Cada lista usa as MESMAS regras do número do card (cashSummary em reports.ts), então a soma dos itens é igual ao
 * valor mostrado: lançamentos reais, uma linha por fatura (o que falta pagar dela) e, nos meses futuros, o que os
 * fixos e recorrentes vão gerar (ocorrências futuras não são gravadas: vêm da projeção).
 */
import { inArray, sql } from 'drizzle-orm';
import { isScheduled } from '@/domain/account/rules';
import { compareDates, monthEnd, monthStart, type ISODate } from '@/domain/dates';
import type { Cents } from '@/domain/money';
import { projectedItems } from '@/domain/reports/projection';
import { centsFromDb } from '@/server/context';
import type { AnyDB } from '../client';
import { recurringTemplates } from '../schema';
import { listEntries, type EntryRow } from './entries';
import { loadProjectionTemplates } from './reports';

export type SummaryKind = 'entrou' | 'saiu' | 'a-receber' | 'a-pagar';
export const SUMMARY_KINDS: readonly SummaryKind[] = ['entrou', 'saiu', 'a-receber', 'a-pagar'];

/** Saídas da conta (mesmos tipos do "Saiu" do resumo de caixa). */
const OUT_KINDS = new Set(['EXPENSE', 'INVOICE_PAYMENT', 'ANTICIPATION_PAYMENT']);

export type InvoiceLine = {
  invoiceId: string;
  cardName: string;
  referenceMonth: ISODate;
  dueDate: ISODate;
  closingDate: ISODate;
  /** o que falta pagar da fatura (total − pago) */
  remainingCents: Cents;
  /** a fatura já fechou */
  closed: boolean;
};

export type ProjectedLine = {
  templateId: string;
  description: string;
  dueDate: ISODate;
  amountCents: Cents;
  /** assinatura no cartão (vai para a fatura) */
  subscription: boolean;
};

export type SummaryDetail = {
  kind: SummaryKind;
  month: ISODate;
  entries: EntryRow[];
  invoices: InvoiceLine[];
  projected: ProjectedLine[];
  totalCents: Cents;
};

/** Uma linha por fatura que vence no mês e ainda tem valor a pagar. */
async function invoiceLines(db: AnyDB, from: ISODate, to: ISODate, today: ISODate): Promise<InvoiceLine[]> {
  const r = (await db.execute(
    sql`select v.id as id, c.name as card_name, v.reference_month::text as reference_month,
               v.due_date::text as due_date, v.closing_date::text as closing_date,
               greatest(0, tot.total - coalesce(pay.paid, 0)) as remaining
        from invoices v
        join credit_cards c on c.id = v.credit_card_id
        join (select invoice_id, sum(amount_cents) total from invoice_items where status = 'ACTIVE' group by invoice_id) tot
          on tot.invoice_id = v.id
        left join (select paid_invoice_id, sum(amount_cents) paid from transactions
                   where kind = 'INVOICE_PAYMENT' and status = 'POSTED' and deleted_at is null group by paid_invoice_id) pay
          on pay.paid_invoice_id = v.id
        where v.due_date between ${from} and ${to}
          and greatest(0, tot.total - coalesce(pay.paid, 0)) > 0
        order by v.due_date, c.name`,
  )) as unknown;
  const rows = (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as {
    id: string;
    card_name: string;
    reference_month: string;
    due_date: string;
    closing_date: string;
    remaining: string;
  }[];
  return rows.map((x) => ({
    invoiceId: x.id,
    cardName: x.card_name,
    referenceMonth: x.reference_month,
    dueDate: x.due_date,
    closingDate: x.closing_date,
    remainingCents: centsFromDb(x.remaining),
    closed: compareDates(x.closing_date, today) <= 0,
  }));
}

export async function summaryDetail(
  db: AnyDB,
  kind: SummaryKind,
  month: ISODate,
  today: ISODate,
): Promise<SummaryDetail> {
  const from = monthStart(month);
  const to = monthEnd(month);
  const all = await listEntries(db, { month: from });

  const posted = (e: EntryRow) => e.status === 'POSTED' && !isScheduled(e, today);
  const waiting = (e: EntryRow) => e.status === 'PENDING' || isScheduled(e, today);
  const isOut = (e: EntryRow) => OUT_KINDS.has(e.kind);
  const notIncome = (e: EntryRow) => e.loanId !== null || e.fundingForId !== null;

  const entries = all.filter((e) => {
    switch (kind) {
      case 'entrou': // o dinheiro de empréstimo e o aporte entram no saldo mas não são receita
        return e.kind === 'INCOME' && !notIncome(e) && posted(e);
      case 'saiu':
        return isOut(e) && posted(e);
      case 'a-receber':
        return e.kind === 'INCOME' && !notIncome(e) && waiting(e);
      case 'a-pagar': // pendentes são só despesas; agendados, qualquer saída da conta
        return (e.kind === 'EXPENSE' && e.status === 'PENDING') || (isOut(e) && isScheduled(e, today));
    }
  });
  // feitos: o mais recente primeiro; a vir: o mais próximo primeiro
  const done = kind === 'entrou' || kind === 'saiu';
  entries.sort((a, b) => (done ? compareDates(b.date, a.date) : compareDates(a.date, b.date)));

  const invoices = kind === 'a-pagar' ? await invoiceLines(db, from, to, today) : [];

  // meses depois do atual: ocorrências dos fixos ainda não gravadas (D68)
  let projected: ProjectedLine[] = [];
  if ((kind === 'a-receber' || kind === 'a-pagar') && compareDates(from, monthStart(today)) > 0) {
    const items = projectedItems(await loadProjectionTemplates(db), from, today).filter((i) =>
      kind === 'a-receber' ? i.direction === 'INCOME' && !i.subscription : i.direction === 'EXPENSE',
    );
    const names = items.length
      ? await db
          .select({ id: recurringTemplates.id, description: recurringTemplates.description })
          .from(recurringTemplates)
          .where(
            inArray(
              recurringTemplates.id,
              items.map((i) => i.templateId),
            ),
          )
      : [];
    projected = items.map((i) => ({
      templateId: i.templateId,
      description: names.find((n) => n.id === i.templateId)?.description ?? 'Fixo',
      dueDate: i.dueDate,
      amountCents: i.amountCents,
      subscription: i.subscription,
    }));
  }

  const totalCents =
    entries.reduce((s, e) => s + e.amountCents, 0) +
    invoices.reduce((s, i) => s + i.remainingCents, 0) +
    projected.reduce((s, p) => s + p.amountCents, 0);
  return { kind, month: from, entries, invoices, projected, totalCents };
}
