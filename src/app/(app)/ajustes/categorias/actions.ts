'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { parseAliases } from '@/domain/categories';
import { type ActionResult, fail, ok } from '@/lib/action-result';
import { createCategory, setCategoryArchived, updateCategory } from '@/server/categories';
import { runAction } from '@/server/context';
import { firstIssue } from '@/server/schemas';
import { getServiceCtx } from '@/server/session';

type Prev = ActionResult<null> | null;
const refresh = () => revalidatePath('/', 'layout');

/** Texto livre → apelidos; erro em pt-BR vira resposta da ação, nunca exceção. */
const aliasesField = z
  .string()
  .default('')
  .transform((v, ctx) => {
    try {
      return parseAliases(v);
    } catch (err) {
      ctx.addIssue({ code: 'custom', message: err instanceof Error ? err.message : 'Apelidos inválidos.' });
      return z.NEVER;
    }
  });

const createInput = z.object({
  kind: z.enum(['EXPENSE', 'INCOME'], { error: 'Escolha se é despesa ou receita.' }),
  name: z.string({ error: 'Informe o nome da categoria.' }),
  aliases: aliasesField,
});

const updateInput = z.object({
  id: z.uuid(),
  name: z.string({ error: 'Informe o nome da categoria.' }),
  aliases: aliasesField,
});

export async function createCategoryAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = createInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => createCategory(await getServiceCtx(), parsed.data));
  if (!r.ok) return r;
  refresh();
  return ok(null);
}

export async function updateCategoryAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = updateInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { id, ...input } = parsed.data;
  const r = await runAction(async () => updateCategory(await getServiceCtx(), id, input));
  if (!r.ok) return r;
  refresh();
  return ok(null);
}

const idOnly = z.object({ id: z.uuid() });

export async function archiveCategoryAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = idOnly.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail('Categoria inválida.');
  const r = await runAction(async () => setCategoryArchived(await getServiceCtx(), parsed.data.id, true));
  if (!r.ok) return r;
  refresh();
  return ok(null);
}

export async function restoreCategoryAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = idOnly.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail('Categoria inválida.');
  const r = await runAction(async () => setCategoryArchived(await getServiceCtx(), parsed.data.id, false));
  if (!r.ok) return r;
  refresh();
  return ok(null);
}
