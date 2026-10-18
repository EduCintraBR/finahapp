'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ActionResult, fail } from '@/lib/action-result';
import { runAction } from '@/server/context';
import { confirmPayment, createEntry, removeEntry, revertPayment, updateEntry } from '@/server/entries';
import { confirmPaymentInput, entryInput, firstIssue, versionInput } from '@/server/schemas';
import { getServiceCtx } from '@/server/session';

/** Só caminhos internos. */
const back = (fd: FormData, fallback = '/lancamentos') => {
  const v = fd.get('returnTo');
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : fallback;
};

const done = (to: string): never => {
  revalidatePath('/', 'layout');
  redirect(to);
};

export async function saveEntryAction(
  _prev: ActionResult<null> | null,
  fd: FormData,
): Promise<ActionResult<null>> {
  const parsed = entryInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const id = fd.get('id');
  const r = await runAction(async () => {
    const ctx = await getServiceCtx();
    if (typeof id === 'string' && id) {
      await updateEntry(ctx, id, versionInput.parse(fd.get('version')), parsed.data);
    } else {
      await createEntry(ctx, parsed.data);
    }
  });
  if (!r.ok) return r;
  return done(back(fd));
}

export async function removeEntryAction(
  _prev: ActionResult<null> | null,
  fd: FormData,
): Promise<ActionResult<null>> {
  const r = await runAction(async () => {
    const ctx = await getServiceCtx();
    await removeEntry(ctx, String(fd.get('id')), versionInput.parse(fd.get('version')));
  });
  if (!r.ok) return r;
  return done(back(fd));
}

export async function confirmPaymentAction(
  _prev: ActionResult<null> | null,
  fd: FormData,
): Promise<ActionResult<null>> {
  const parsed = confirmPaymentInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => {
    const ctx = await getServiceCtx();
    await confirmPayment(ctx, String(fd.get('id')), versionInput.parse(fd.get('version')), parsed.data);
  });
  if (!r.ok) return r;
  revalidatePath('/', 'layout');
  return { ok: true, data: null };
}

export async function revertPaymentAction(
  _prev: ActionResult<null> | null,
  fd: FormData,
): Promise<ActionResult<null>> {
  const r = await runAction(async () => {
    const ctx = await getServiceCtx();
    await revertPayment(ctx, String(fd.get('id')), versionInput.parse(fd.get('version')));
  });
  if (!r.ok) return r;
  revalidatePath('/', 'layout');
  return { ok: true, data: null };
}
