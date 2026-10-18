/**
 * D27 — o banco mudou o fechamento de uma fatura ABERTA: compras afetadas andam ou voltam
 * uma fatura (o plano inteiro), para continuar valendo a regra "menor fechamento > data da compra".
 */
import { addMonths, compareDates, type ISODate } from '../dates';

export type PlanPlacement = {
  planId: string;
  description: string;
  purchaseDate: ISODate;
  /** mês de referência da fatura da 1ª parcela rastreada */
  firstReferenceMonth: ISODate;
  /** onboarding: a fatura foi escolhida pelo usuário, não pela data — nunca realocar */
  onboarding: boolean;
  /** todas as parcelas ACTIVE, em faturas abertas, sem antecipação nem estorno */
  movable: boolean;
};

export type ClosingChange = {
  referenceMonth: ISODate;
  oldClosing: ISODate;
  newClosing: ISODate;
  dueDate: ISODate;
  /** fechamento efetivo da fatura anterior e da seguinte (materializada ou regra) */
  prevClosing: ISODate;
  nextClosing: ISODate;
  today: ISODate;
};

export type ReallocationPlan = { forward: PlanPlacement[]; backward: PlanPlacement[] };

export function planClosingChange(
  c: ClosingChange,
  plans: readonly PlanPlacement[],
): ReallocationPlan | { error: string } {
  if (compareDates(c.today, c.oldClosing) >= 0) {
    return { error: 'Só dá para mudar o fechamento de uma fatura aberta.' };
  }
  if (compareDates(c.newClosing, c.dueDate) >= 0)
    return { error: 'O fechamento precisa ser antes do vencimento.' };
  if (compareDates(c.newClosing, c.prevClosing) <= 0) {
    return { error: 'O fechamento precisa ser depois do fechamento da fatura anterior.' };
  }
  if (compareDates(c.newClosing, c.nextClosing) >= 0) {
    return { error: 'O fechamento precisa ser antes do fechamento da fatura seguinte.' };
  }

  const next = addMonths(c.referenceMonth, 1);
  const forward = plans.filter(
    (p) =>
      !p.onboarding &&
      p.firstReferenceMonth === c.referenceMonth &&
      compareDates(p.purchaseDate, c.newClosing) >= 0,
  );
  const backward = plans.filter(
    (p) =>
      !p.onboarding &&
      p.firstReferenceMonth === next &&
      compareDates(p.purchaseDate, c.newClosing) < 0 &&
      compareDates(p.purchaseDate, c.prevClosing) >= 0,
  );
  const stuck = [...forward, ...backward].find((p) => !p.movable);
  if (stuck) {
    return {
      error: `A compra "${stuck.description}" mudaria de fatura, mas tem parcela antecipada, estornada ou em fatura fechada. Ajuste-a antes.`,
    };
  }
  return { forward, backward };
}
