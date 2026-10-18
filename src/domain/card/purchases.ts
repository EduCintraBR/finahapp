/**
 * Compra no cartão (invariante 4): 1 transaction EXPENSE + 1 plano + N parcelas.
 * À vista = 1 parcela. Σ parcelas = total; o resto do arredondamento vai na 1ª parcela.
 * Parcelamento em andamento (onboarding, D9): só as parcelas a partir da atual.
 */
import { assertCents, MoneyError, splitInstallments, type Cents } from '../money';

export type InstallmentLine = { number: number; amountCents: Cents };

export function buildInstallments(total: Cents, count: number, firstTracked = 1): InstallmentLine[] {
  if (!Number.isInteger(firstTracked) || firstTracked < 1 || firstTracked > count) {
    throw new MoneyError(`A parcela atual precisa estar entre 1 e ${count}.`);
  }
  return splitInstallments(total, count)
    .map((amountCents, i) => ({ number: i + 1, amountCents }))
    .slice(firstTracked - 1);
}

// ─────────── antecipação (SPEC §3.5, D32) ───────────

export type PlanItem = {
  id: string;
  kind: 'INSTALLMENT' | 'ANTICIPATION' | 'REFUND_CREDIT' | 'ADJUSTMENT';
  status: 'ACTIVE' | 'ANTICIPATED' | 'CANCELLED';
  installmentNumber: number | null;
  amountCents: Cents;
  /** a fatura do item já fechou? (hoje ≥ fechamento) */
  invoiceClosed: boolean;
};

/** Parcelas que ainda podem ser antecipadas: ACTIVE e em fatura que não fechou. */
export function anticipatable(items: readonly PlanItem[]): PlanItem[] {
  return items
    .filter((i) => i.kind === 'INSTALLMENT' && i.status === 'ACTIVE' && !i.invoiceClosed)
    .sort((a, b) => a.installmentNumber! - b.installmentNumber!);
}

/** Padrão: as últimas n parcelas. */
export function defaultAnticipationSelection(items: readonly PlanItem[], n: number): PlanItem[] {
  const open = anticipatable(items);
  return open.slice(Math.max(0, open.length - n));
}

export type AnticipationPlan = { grossCents: Cents; discountCents: Cents; paidCents: Cents };

/**
 * Bruto = Σ das parcelas escolhidas (é o que libera de limite); pago = o que o banco cobra;
 * desconto = bruto − pago. Erro (pt-BR) se a seleção ou o valor não fecham.
 */
export function planAnticipation(
  items: readonly PlanItem[],
  selectedIds: readonly string[],
  paidCents: Cents,
): AnticipationPlan | { error: string } {
  if (selectedIds.length === 0) return { error: 'Escolha ao menos uma parcela.' };
  if (new Set(selectedIds).size !== selectedIds.length) return { error: 'Parcela repetida na seleção.' };
  const open = new Map(anticipatable(items).map((i) => [i.id, i]));
  const chosen = selectedIds.map((id) => open.get(id));
  if (chosen.some((i) => !i))
    return { error: 'Só dá para antecipar parcelas de faturas que ainda não fecharam.' };
  assertCents(paidCents, 'valor pago');
  const grossCents = chosen.reduce((s, i) => s + i!.amountCents, 0);
  if (paidCents <= 0) return { error: 'O valor pago precisa ser maior que zero.' };
  if (paidCents > grossCents) return { error: 'O valor pago não pode ser maior que a soma das parcelas.' };
  return { grossCents, discountCents: grossCents - paidCents, paidCents };
}

// ─────────── estornos (SPEC §3.6, D26) ───────────

/** Modo A: crédito de qualquer valor até o que ainda não foi estornado da compra. */
export function checkPartialRefund(
  amountCents: Cents,
  purchaseTotal: Cents,
  alreadyRefunded: Cents,
): string | null {
  assertCents(amountCents);
  if (amountCents <= 0) return 'O valor do estorno precisa ser maior que zero.';
  if (amountCents > purchaseTotal - alreadyRefunded) {
    return 'O estorno não pode passar do valor da compra que ainda não foi estornado.';
  }
  return null;
}

export type CancelPurchasePlan = {
  /** itens (parcelas e antecipações na fatura) em faturas abertas/futuras → CANCELLED */
  cancelItemIds: string[];
  /** crédito único (positivo; vira item REFUND_CREDIT negativo) — 0 = nenhum item */
  creditCents: Cents;
  /** quanto sai do Gasto Bruto no mês do estorno (refund_records.amount) */
  grossRefundCents: Cents;
};

/**
 * Modo B — cancelamento total (D26).
 *  - itens ainda não cobrados (fatura aberta/futura) são cancelados;
 *  - crédito = itens já cobrados (fatura fechada/paga) + antecipações pagas avulsas
 *    − créditos de estornos anteriores;
 *  - Gasto Bruto abate a compra inteira menos o que já foi estornado
 *    (onboarding: só a parte que o app conhece, pois a compra nunca entrou no bruto).
 */
export function planCancelPurchase(p: {
  items: readonly PlanItem[];
  purchaseTotal: Cents;
  trackedTotal: Cents;
  onboarding: boolean;
  directAnticipationsPaid: Cents;
  previousRefundRecords: Cents;
}): CancelPurchasePlan | { error: string } {
  const live = p.items.filter(
    (i) => i.status === 'ACTIVE' && (i.kind === 'INSTALLMENT' || i.kind === 'ANTICIPATION'),
  );
  const cancelItemIds = live.filter((i) => !i.invoiceClosed).map((i) => i.id);
  const charged =
    live.filter((i) => i.invoiceClosed).reduce((s, i) => s + i.amountCents, 0) + p.directAnticipationsPaid;
  const previousCredits = -p.items
    .filter((i) => i.kind === 'REFUND_CREDIT' && i.status === 'ACTIVE')
    .reduce((s, i) => s + i.amountCents, 0);
  const creditCents = Math.max(0, charged - previousCredits);
  const base = p.onboarding ? p.trackedTotal : p.purchaseTotal;
  const grossRefundCents = Math.max(0, base - p.previousRefundRecords);
  if (cancelItemIds.length === 0 && creditCents === 0 && grossRefundCents === 0) {
    return { error: 'Esta compra já está totalmente estornada.' };
  }
  return { cancelItemIds, creditCents, grossRefundCents };
}
