'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ActionResult, fail } from '@/lib/action-result';
import { runAction } from '@/server/context';
import { changeTemplateFrom, createTemplate, deleteTemplate, endTemplate } from '@/server/recurring';
import { changeFromInput, endTemplateInput, firstIssue, templateInput } from '@/server/schemas';
import { getServiceCtx } from '@/server/session';

export async function createTemplateAction(
  _prev: ActionResult<null> | null,
  fd: FormData,
): Promise<ActionResult<null>> {
  const parsed = templateInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => createTemplate(await getServiceCtx(), parsed.data));
  if (!r.ok) return r;
  revalidatePath('/', 'layout');
  redirect(`/fixos/${r.data.id}`);
}

export async function changeFromAction(
  _prev: ActionResult<null> | null,
  fd: FormData,
): Promise<ActionResult<null>> {
  const parsed = changeFromInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () =>
    changeTemplateFrom(await getServiceCtx(), String(fd.get('id')), parsed.data),
  );
  if (!r.ok) return r;
  revalidatePath('/', 'layout');
  redirect(`/fixos/${r.data.id}`);
}

export async function endTemplateAction(
  _prev: ActionResult<null> | null,
  fd: FormData,
): Promise<ActionResult<null>> {
  const parsed = endTemplateInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const id = String(fd.get('id'));
  const r = await runAction(async () => endTemplate(await getServiceCtx(), id, parsed.data.lastMonth));
  if (!r.ok) return r;
  revalidatePath('/', 'layout');
  redirect(`/fixos/${id}`);
}

export async function deleteTemplateAction(
  _prev: ActionResult<null> | null,
  fd: FormData,
): Promise<ActionResult<null>> {
  const r = await runAction(async () => deleteTemplate(await getServiceCtx(), String(fd.get('id') ?? '')));
  if (!r.ok) return r;
  revalidatePath('/', 'layout');
  redirect('/fixos');
}
