'use server';

import { revalidatePath } from 'next/cache';
import { type ActionResult, fail } from '@/lib/action-result';
import { getPrimaryAccount } from '@/db/queries/accounts';
import { getAccountBalance } from '@/db/queries/balance';
import { type CheckpointResult, createCheckpoint } from '@/server/checkpoints';
import { runAction, UserError } from '@/server/context';
import { checkpointInput, firstIssue, isoDate } from '@/server/schemas';
import { getServiceCtx } from '@/server/session';

/** Só leitura: saldo calculado até a data, para comparar antes de registrar. */
export async function previewBalanceAction(date: string): Promise<ActionResult<number>> {
  const parsed = isoDate.safeParse(date);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  return runAction(async () => {
    const ctx = await getServiceCtx();
    const account = await getPrimaryAccount(ctx.db);
    if (!account) throw new UserError('A conta principal ainda não foi configurada.');
    return getAccountBalance(ctx.db, account.id, parsed.data);
  });
}

export async function checkpointAction(
  _prev: ActionResult<CheckpointResult> | null,
  fd: FormData,
): Promise<ActionResult<CheckpointResult>> {
  const parsed = checkpointInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => createCheckpoint(await getServiceCtx(), parsed.data));
  if (r.ok) revalidatePath('/', 'layout');
  return r;
}
