'use server';

import { revalidatePath } from 'next/cache';
import { type ActionResult, fail } from '@/lib/action-result';
import { setBudget, stopBudget } from '@/server/budgets';
import { runAction } from '@/server/context';
import { budgetInput, firstIssue, stopBudgetInput } from '@/server/schemas';
import { getServiceCtx } from '@/server/session';

type Prev = ActionResult<null> | null;
const refresh = () => revalidatePath('/', 'layout');

/** Cria o orçamento ou muda o valor a partir de um mês (D79). Fica na mesma tela; o painel fecha sozinho. */
export async function setBudgetAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = budgetInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => setBudget(await getServiceCtx(), parsed.data));
  if (!r.ok) return r;
  refresh();
  return { ok: true, data: null };
}

export async function stopBudgetAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = stopBudgetInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () =>
    stopBudget(await getServiceCtx(), parsed.data.id, parsed.data.fromMonth),
  );
  if (!r.ok) return r;
  refresh();
  return { ok: true, data: null };
}
