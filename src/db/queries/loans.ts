/**
 * Empréstimos (D66): o que falta pagar, o que já foi pago e a economia/acréscimo são DERIVADOS das parcelas
 * (uma transaction por parcela). Nada é armazenado.
 */
import { and, asc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import type { ISODate } from '@/domain/dates';
import { summarizeLoan, type LoanSummary } from '@/domain/loans/loans';
import type { Cents } from '@/domain/money';
import type { AnyDB } from '../client';
import { loans, transactions } from '../schema';

export type LoanInstallmentView = {
  /** id da transaction da parcela */
  id: string;
  number: number;
  dueDate: ISODate;
  scheduledCents: Cents;
  /** valor pago (parcela baixada) ou null se pendente */
  paidCents: Cents | null;
  paidDate: ISODate | null;
  /** adiantou (+) ou atrasou (−) em dias em relação ao vencimento; null se pendente */
  daysEarly: number | null;
  overdue: boolean;
};

export type LoanView = {
  id: string;
  name: string;
  lender: string | null;
  principalCents: Cents;
  totalCents: Cents;
  /** juros embutidos = total a pagar − valor recebido */
  interestCents: Cents;
  installmentCount: number;
  receivedDate: ISODate;
  firstDueDate: ISODate;
  notes: string | null;
  installments: LoanInstallmentView[];
  summary: LoanSummary;
};

function dayDiff(a: ISODate, b: ISODate): number {
  const t = (v: string) => Date.UTC(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, Number(v.slice(8, 10)));
  return Math.round((t(a) - t(b)) / 86_400_000);
}

async function load(db: AnyDB, today: ISODate, onlyId?: string): Promise<LoanView[]> {
  const rows = await db
    .select()
    .from(loans)
    .where(and(isNull(loans.deletedAt), onlyId ? eq(loans.id, onlyId) : undefined))
    .orderBy(asc(loans.createdAt));
  if (rows.length === 0) return [];
  const parcels = await db
    .select({
      id: transactions.id,
      loanId: transactions.loanId,
      number: transactions.loanInstallmentNumber,
      status: transactions.status,
      dueDate: transactions.dueDate,
      postedDate: transactions.postedDate,
      amountCents: transactions.amountCents,
      estimatedAmountCents: transactions.estimatedAmountCents,
    })
    .from(transactions)
    .where(
      and(
        inArray(
          transactions.loanId,
          rows.map((r) => r.id),
        ),
        isNotNull(transactions.loanInstallmentNumber),
        isNull(transactions.deletedAt),
        ne(transactions.status, 'CANCELLED'),
      ),
    )
    .orderBy(asc(transactions.loanInstallmentNumber));
  return rows.map((l) => {
    const installments = parcels
      .filter((p) => p.loanId === l.id)
      .map((p): LoanInstallmentView => {
        const paid = p.status === 'POSTED';
        return {
          id: p.id,
          number: p.number!,
          dueDate: p.dueDate!,
          // paga: o programado é o snapshot da baixa; pendente: é o próprio valor
          scheduledCents: paid ? (p.estimatedAmountCents ?? p.amountCents) : p.amountCents,
          paidCents: paid ? p.amountCents : null,
          paidDate: paid ? p.postedDate : null,
          daysEarly: paid && p.postedDate ? dayDiff(p.dueDate!, p.postedDate) : null,
          overdue: !paid && p.dueDate! < today,
        };
      });
    return {
      id: l.id,
      name: l.name,
      lender: l.lender,
      principalCents: l.principalCents,
      totalCents: l.totalCents,
      interestCents: l.totalCents - l.principalCents,
      installmentCount: l.installmentCount,
      receivedDate: l.receivedDate,
      firstDueDate: l.firstDueDate,
      notes: l.notes,
      installments,
      summary: summarizeLoan(
        installments.map((i) => ({
          number: i.number,
          scheduledCents: i.scheduledCents,
          paidCents: i.paidCents,
          dueDate: i.dueDate,
          paidDate: i.paidDate,
        })),
        today,
      ),
    };
  });
}

/** Empréstimos em aberto primeiro, quitados por último. */
export async function listLoans(db: AnyDB, today: ISODate): Promise<LoanView[]> {
  const all = await load(db, today);
  return [...all.filter((l) => !l.summary.settled), ...all.filter((l) => l.summary.settled)];
}

export async function getLoan(db: AnyDB, id: string, today: ISODate): Promise<LoanView | null> {
  return (await load(db, today, id))[0] ?? null;
}
