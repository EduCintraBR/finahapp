'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ActionResult, fail } from '@/lib/action-result';
import {
  createCardPurchase,
  createOnboardingPlan,
  deleteCardPurchase,
  updateCardPurchase,
} from '@/server/card-purchases';
import {
  archiveCard,
  createCard,
  type InvoiceDatesResult,
  updateCard,
  updateInvoiceDates,
} from '@/server/cards';
import { runAction } from '@/server/context';
import { anticipate, payInvoice, refundPurchase, removeInvoicePayment } from '@/server/invoice-ops';
import {
  anticipationInput,
  cardInput,
  cardPurchaseEditInput,
  cardPurchaseInput,
  firstIssue,
  invoiceDatesInput,
  invoicePaymentInput,
  onboardingInput,
  refundInput,
} from '@/server/schemas';
import { getServiceCtx } from '@/server/session';

type Prev<T = null> = ActionResult<T> | null;
const id = (fd: FormData, key = 'id') => String(fd.get(key) ?? '');
const refresh = () => revalidatePath('/', 'layout');

export async function saveCardAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = cardInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const existing = id(fd);
  const r = await runAction(async () => {
    const ctx = await getServiceCtx();
    if (existing) {
      await updateCard(ctx, existing, parsed.data);
      return { id: existing };
    }
    return createCard(ctx, parsed.data);
  });
  if (!r.ok) return r;
  refresh();
  // editar: fica na tela do cartão (o painel fecha); cadastrar: abre o cartão novo
  if (existing) return { ok: true, data: null };
  redirect(`/cartoes/${r.data.id}`);
}

export async function archiveCardAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const r = await runAction(async () => archiveCard(await getServiceCtx(), id(fd)));
  if (!r.ok) return r;
  refresh();
  redirect('/cartoes');
}

export async function cardPurchaseAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = cardPurchaseInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => createCardPurchase(await getServiceCtx(), parsed.data));
  if (!r.ok) return r;
  refresh();
  // volta para a fatura onde a compra caiu (os detalhes da compra só abrem se você tocar nela)
  redirect(`/cartoes/faturas/${r.data.invoiceId}`);
}

export async function onboardingAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = onboardingInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => createOnboardingPlan(await getServiceCtx(), parsed.data));
  if (!r.ok) return r;
  refresh();
  redirect(`/cartoes/faturas/${r.data.invoiceId}`);
}

export async function editPurchaseAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = cardPurchaseEditInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => updateCardPurchase(await getServiceCtx(), id(fd), parsed.data));
  if (!r.ok) return r;
  refresh();
  return { ok: true, data: null };
}

export async function deletePurchaseAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const r = await runAction(async () => deleteCardPurchase(await getServiceCtx(), id(fd)));
  if (!r.ok) return r;
  refresh();
  redirect(`/cartoes/${id(fd, 'cardId')}`);
}

export async function payInvoiceAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = invoicePaymentInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => payInvoice(await getServiceCtx(), id(fd), parsed.data));
  if (!r.ok) return r;
  refresh();
  return { ok: true, data: null };
}

export async function removePaymentAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const r = await runAction(async () => removeInvoicePayment(await getServiceCtx(), id(fd)));
  if (!r.ok) return r;
  refresh();
  return { ok: true, data: null };
}

export async function invoiceDatesAction(
  _p: Prev<InvoiceDatesResult>,
  fd: FormData,
): Promise<ActionResult<InvoiceDatesResult>> {
  const parsed = invoiceDatesInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => updateInvoiceDates(await getServiceCtx(), id(fd), parsed.data));
  if (r.ok) refresh();
  return r;
}

export async function anticipateAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = anticipationInput.safeParse({ ...Object.fromEntries(fd), itemIds: fd.getAll('itemIds') });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => anticipate(await getServiceCtx(), id(fd, 'planId'), parsed.data));
  if (!r.ok) return r;
  refresh();
  return { ok: true, data: null };
}

export async function refundAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = refundInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => refundPurchase(await getServiceCtx(), id(fd, 'planId'), parsed.data));
  if (!r.ok) return r;
  refresh();
  return { ok: true, data: null };
}
