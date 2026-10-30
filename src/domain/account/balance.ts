/**
 * Saldo da conta (fórmula canônica):
 *   opening_balance + Σ entradas − Σ saídas, só status = POSTED e não deletadas.
 * Tipos espelham os enums do schema, mas o domínio não depende do banco.
 */
import { compareDates, type ISODate } from '../dates';
import { assertCents, type Cents } from '../money';

export const INFLOW_KINDS = ['INCOME', 'TRANSFER_IN', 'ADJUSTMENT_IN'] as const;
export const OUTFLOW_KINDS = [
  'EXPENSE',
  'INVOICE_PAYMENT',
  'ANTICIPATION_PAYMENT',
  'TRANSFER_OUT',
  'ADJUSTMENT_OUT',
] as const;

export type TransactionKind = (typeof INFLOW_KINDS)[number] | (typeof OUTFLOW_KINDS)[number];
export type TransactionStatus = 'PENDING' | 'POSTED' | 'CANCELLED' | 'ANTICIPATED';

const INFLOW = new Set<TransactionKind>(INFLOW_KINDS);

export function isInflow(kind: TransactionKind): boolean {
  return INFLOW.has(kind);
}

/** Efeito do lançamento no caixa: positivo entra, negativo sai. `amount` é sempre > 0. */
export function signedAmount(kind: TransactionKind, amount: Cents): Cents {
  assertCents(amount);
  if (amount <= 0) throw new RangeError('Valor de lançamento precisa ser maior que zero.');
  return isInflow(kind) ? amount : -amount;
}

export type BalanceEntry = {
  kind: TransactionKind;
  status: TransactionStatus;
  amountCents: Cents;
  postedDate: ISODate | null;
  deleted: boolean;
};

/** Conta para o saldo? (POSTED, não deletado e, se houver corte, com posted_date ≤ asOf.) */
export function countsForBalance(e: BalanceEntry, asOf?: ISODate): boolean {
  if (e.status !== 'POSTED' || e.deleted) return false;
  if (asOf === undefined) return true;
  return e.postedDate !== null && compareDates(e.postedDate, asOf) <= 0;
}

export function computeBalance(opening: Cents, entries: readonly BalanceEntry[], asOf?: ISODate): Cents {
  assertCents(opening, 'saldo inicial');
  let total = opening;
  for (const e of entries) if (countsForBalance(e, asOf)) total += signedAmount(e.kind, e.amountCents);
  assertCents(total, 'saldo');
  return total;
}

export type Adjustment = { kind: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT'; amountCents: Cents };

/**
 * Lançamento que faz o saldo calculado bater com o do banco (conferência de saldo).
 * null quando já bate.
 */
export function balanceAdjustment(statement: Cents, computed: Cents): Adjustment | null {
  assertCents(statement, 'saldo do banco');
  assertCents(computed, 'saldo calculado');
  const diff = statement - computed;
  if (diff === 0) return null;
  return diff > 0
    ? { kind: 'ADJUSTMENT_IN', amountCents: diff }
    : { kind: 'ADJUSTMENT_OUT', amountCents: -diff };
}
