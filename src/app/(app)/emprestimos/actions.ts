'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ActionResult, fail } from '@/lib/action-result';
import { runAction } from '@/server/context';
import { createLoan, deleteLoan, payLoanInstallments } from '@/server/loans';
import { firstIssue, loanInput, loanPaymentInput } from '@/server/schemas';
import { getServiceCtx } from '@/server/session';

const refresh = () => revalidatePath('/', 'layout');

export async function createLoanAction(
  _p: ActionResult<null> | null,
  fd: FormData,
): Promise<ActionResult<null>> {
  const parsed = loanInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => createLoan(await getServiceCtx(), parsed.data));
  if (!r.ok) return r;
  refresh();
  redirect(`/emprestimos/${r.data.id}`);
}

export type PayLoanResult = { paidCents: number; savingsCents: number; lateFeesCents: number };

export async function payLoanAction(
  _p: ActionResult<PayLoanResult> | null,
  fd: FormData,
): Promise<ActionResult<PayLoanResult>> {
  const parsed = loanPaymentInput.safeParse({
    installmentIds: fd.getAll('installmentId').map(String),
    paid: fd.get('paid'),
    date: fd.get('date'),
    fundingAmount: fd.get('fundingAmount') ?? undefined,
    fundingNote: fd.get('fundingNote') ?? undefined,
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () =>
    payLoanInstallments(await getServiceCtx(), String(fd.get('loanId') ?? ''), parsed.data),
  );
  if (!r.ok) return r;
  refresh();
  const { paidCents, savingsCents, lateFeesCents } = r.data;
  return { ok: true, data: { paidCents, savingsCents, lateFeesCents } };
}

export async function deleteLoanAction(
  _p: ActionResult<null> | null,
  fd: FormData,
): Promise<ActionResult<null>> {
  const r = await runAction(async () => deleteLoan(await getServiceCtx(), String(fd.get('id') ?? '')));
  if (!r.ok) return r;
  refresh();
  redirect('/emprestimos');
}
