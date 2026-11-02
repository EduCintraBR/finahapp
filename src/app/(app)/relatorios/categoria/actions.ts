'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { type ActionResult, fail, ok } from '@/lib/action-result';
import { setTransactionCategory } from '@/server/categorize';
import { runAction } from '@/server/context';
import { firstIssue } from '@/server/schemas';
import { getServiceCtx } from '@/server/session';

const input = z.object({
  id: z.uuid({ error: 'Lançamento inválido.' }),
  version: z.coerce.number().int().min(0, { error: 'Lançamento inválido.' }),
  categoryId: z.uuid({ error: 'Escolha uma categoria.' }),
  scope: z.enum(['THIS', 'THIS_AND_FUTURE']).default('THIS'),
});

/** Troca a categoria de um lançamento (D75) a partir do detalhe da categoria. */
export async function setCategoryAction(
  _p: ActionResult<null> | null,
  fd: FormData,
): Promise<ActionResult<null>> {
  const parsed = input.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { id, ...rest } = parsed.data;
  const r = await runAction(async () => setTransactionCategory(await getServiceCtx(), id, rest));
  if (!r.ok) return r;
  revalidatePath('/', 'layout');
  return ok(null);
}
