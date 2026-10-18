'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { type ActionResult, fail, ok } from '@/lib/action-result';
import { updateOpeningBalance } from '@/server/account-settings';
import { runAction } from '@/server/context';
import { firstIssue, isoDate, money } from '@/server/schemas';
import { getServiceCtx } from '@/server/session';

const openingBalanceInput = z.object({
  amount: money({ positive: false, label: 'o saldo inicial' }),
  date: isoDate,
});

/** D44: corrige o saldo inicial da conta principal (fica no audit_log). */
export async function updateOpeningBalanceAction(
  _p: ActionResult<null> | null,
  fd: FormData,
): Promise<ActionResult<null>> {
  const parsed = openingBalanceInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => updateOpeningBalance(await getServiceCtx(), parsed.data));
  if (r.ok) revalidatePath('/', 'layout');
  return r.ok ? ok(null) : r;
}
