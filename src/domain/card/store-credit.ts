/**
 * Crediário (D73): crédito de loja (Shopee Parcelado, carnê Magalu...) que funciona como um cartão, com ciclo
 * próprio. A 1ª compra abre uma fatura que vence `firstDueDays` dias depois e fecha `closeBeforeDays` dias antes
 * do vencimento. Enquanto o ciclo está ativo as faturas seguem mensais, no mesmo dia; um ciclo novo só começa
 * quando todas as faturas já venceram e estão pagas. Juros: o usuário informa o valor original e o total a pagar.
 */
import { addDays, addMonths, compareDates, diffDays, monthStart, type ISODate } from '../dates';
import { assertCents, type Cents } from '../money';
import { cardRule, resolveInvoice, windowFor, type CardTerms, type InvoiceWindow } from './invoices';

export type StoreCreditTerms = { firstDueDays: number; closeBeforeDays: number };

export const DEFAULT_STORE_CREDIT_TERMS: StoreCreditTerms = { firstDueDays: 40, closeBeforeDays: 7 };
export const MAX_FIRST_DUE_DAYS = 120;

/** Mensagem de erro (pt-BR) ou null se o prazo e o fechamento fazem sentido. */
export function checkStoreCreditTerms(t: StoreCreditTerms): string | null {
  if (!Number.isInteger(t.firstDueDays) || t.firstDueDays < 2 || t.firstDueDays > MAX_FIRST_DUE_DAYS) {
    return `Prazo da 1ª fatura: de 2 a ${MAX_FIRST_DUE_DAYS} dias.`;
  }
  if (!Number.isInteger(t.closeBeforeDays) || t.closeBeforeDays < 1) {
    return 'A fatura precisa fechar pelo menos 1 dia antes do vencimento.';
  }
  if (t.closeBeforeDays >= t.firstDueDays) {
    return 'A fatura precisa fechar depois da compra: use menos dias antes do vencimento que o prazo da 1ª fatura.';
  }
  return null;
}

/** Fatura materializada do crediário; `settled` = total ≤ pago (sem nada em aberto). */
export type StoreCreditInvoice = InvoiceWindow & { settled: boolean };

export type StoreCreditPlacement = {
  window: InvoiceWindow;
  /** dia do vencimento do ciclo (as faturas seguintes vencem nesse dia, mês a mês) */
  anchorDay: number;
  newCycle: boolean;
};

/**
 * Fatura da compra no crediário (D73).
 * - Ciclo ativo (alguma fatura vence na data da compra ou depois, ou ainda tem saldo em aberto): a compra vai
 *   para a fatura de menor fechamento > data da compra (invariante 5), com as faturas mensais do ciclo.
 * - Senão (nenhuma fatura, ou todas vencidas e pagas): ciclo novo, vencendo `firstDueDays` dias após a compra.
 */
export function resolveStoreCreditInvoice(
  purchaseDate: ISODate,
  invoices: readonly StoreCreditInvoice[],
  anchorDay: number,
  terms: StoreCreditTerms,
): StoreCreditPlacement {
  const active = invoices
    .filter((i) => compareDates(i.dueDate, purchaseDate) >= 0 || !i.settled)
    .map((i) => i.referenceMonth)
    .sort();
  if (active.length > 0) {
    // menor fechamento > data da compra, sem voltar para antes da 1ª fatura ativa do ciclo
    const rule = { dueDay: anchorDay, closeBeforeDays: terms.closeBeforeDays };
    const lastMonth = addMonths(monthStart(purchaseDate), -1);
    let month = compareDates(active[0]!, lastMonth) > 0 ? active[0]! : lastMonth;
    for (;;) {
      const w = windowFor(month, invoices, rule);
      if (compareDates(w.closingDate, purchaseDate) > 0) return { window: w, anchorDay, newCycle: false };
      month = addMonths(month, 1);
    }
  }
  const dueDate = addDays(purchaseDate, terms.firstDueDays);
  return {
    window: {
      referenceMonth: monthStart(dueDate),
      closingDate: addDays(dueDate, -terms.closeBeforeDays),
      dueDate,
    },
    anchorDay: Number(dueDate.slice(8)),
    newCycle: true,
  };
}

export type PurchaseInterest = {
  /** acréscimo = total a pagar − valor original */
  extraCents: Cents;
  /** acréscimo sobre o valor original, em % (só para exibir) */
  percent: number;
  /** taxa mensal equivalente, em % (só para exibir; null sem acréscimo) */
  monthlyRate: number | null;
};

/**
 * Juros embutidos de uma compra parcelada (D73). A taxa mensal é a que iguala o valor original ao valor presente
 * das parcelas, cada uma descontada pelos dias entre a compra e o vencimento dela (mês de 30 dias). Números
 * fracionários aqui são só para exibir: o dinheiro continua em centavos inteiros.
 */
export function purchaseInterest(
  originalCents: Cents,
  installments: readonly { amountCents: Cents; dueDate: ISODate }[],
  purchaseDate: ISODate,
): PurchaseInterest {
  assertCents(originalCents);
  if (originalCents <= 0) throw new Error('O valor original precisa ser maior que zero.');
  const total = installments.reduce((s, p) => s + p.amountCents, 0);
  const extraCents = total - originalCents;
  if (extraCents < 0) throw new Error('O total a pagar não pode ser menor que o valor original.');
  const percent = (extraCents * 100) / originalCents;
  if (extraCents === 0) return { extraCents, percent: 0, monthlyRate: null };

  const periods = installments.map((p) => ({
    amount: p.amountCents,
    months: Math.max(diffDays(p.dueDate, purchaseDate), 1) / 30,
  }));
  const presentValue = (rate: number) =>
    periods.reduce((s, p) => s + p.amount / Math.pow(1 + rate, p.months), 0);
  // valor presente cai conforme a taxa sobe: bissecção entre 0 e uma taxa alta o bastante
  let lo = 0;
  let hi = 1;
  while (presentValue(hi) > originalCents) hi *= 2;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (presentValue(mid) > originalCents) lo = mid;
    else hi = mid;
  }
  return { extraCents, percent, monthlyRate: ((lo + hi) / 2) * 100 };
}

const pct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 4.9123 → "4,91%". */
export function formatPercent(value: number): string {
  return `${pct.format(value)}%`;
}

/**
 * Fatura de uma compra feita em `date`, no cartão (invariante 5) ou no crediário (ciclo D73). `invoices` são as
 * faturas materializadas, com o total e o que já foi pago (o crediário precisa saber se o ciclo terminou).
 */
export function placePurchase(
  card: CardTerms,
  date: ISODate,
  invoices: readonly (InvoiceWindow & { totalCents: Cents; paidCents: Cents })[],
): StoreCreditPlacement {
  if (card.kind === 'CARD') {
    return {
      window: resolveInvoice(date, invoices, cardRule(card)),
      anchorDay: card.dueDay,
      newCycle: false,
    };
  }
  if (card.firstDueDays === null || card.closeBeforeDays === null) throw new Error('Crediário sem prazo.');
  return resolveStoreCreditInvoice(
    date,
    invoices.map((i) => ({ ...i, settled: i.totalCents <= i.paidCents })),
    card.dueDay,
    { firstDueDays: card.firstDueDays, closeBeforeDays: card.closeBeforeDays },
  );
}
