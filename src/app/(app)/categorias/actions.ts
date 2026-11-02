'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { parseAliases } from '@/domain/categories';
import { type ActionResult, fail, ok } from '@/lib/action-result';
import {
  createCategory,
  createSubcategory,
  moveCategory,
  setCategoryArchived,
  updateCategory,
} from '@/server/categories';
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

const name = z.string({ error: 'Informe o nome.' });
/** Toda subcategoria tem uma categoria (D77). */
const parentField = z.uuid({ error: 'Escolha a categoria.' });

const createInput = z.object({
  kind: z.enum(['EXPENSE', 'INCOME'], { error: 'Escolha se é despesa ou receita.' }),
  name,
  aliases: aliasesField,
});

const createSubInput = z.object({
  parentId: parentField,
  name,
  aliases: aliasesField,
  /** de onde veio: da edição da categoria (o "+") volta para ela; da lista, volta para a lista */
  voltar: z.enum(['categoria', 'lista']).default('lista'),
});

const updateInput = z.object({ id: z.uuid(), name, aliases: aliasesField });
const updateSubInput = updateInput.extend({ parentId: parentField });

/** Categoria nova abre a própria edição, onde já dá para criar as subcategorias. */
export async function createCategoryAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = createInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => createCategory(await getServiceCtx(), parsed.data));
  if (!r.ok) return r;
  refresh();
  redirect(`/categorias/${r.data.id}`);
}

export async function createSubcategoryAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = createSubInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { voltar, ...input } = parsed.data;
  const r = await runAction(async () => createSubcategory(await getServiceCtx(), input));
  if (!r.ok) return r;
  refresh();
  redirect(voltar === 'categoria' ? `/categorias/${input.parentId}` : '/categorias/subcategorias');
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

/** Edição da subcategoria: nome, apelidos e a categoria dela, numa transação só. */
export async function updateSubcategoryAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = updateSubInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { id, ...input } = parsed.data;
  const r = await runAction(async () => updateCategory(await getServiceCtx(), id, input));
  if (!r.ok) return r;
  refresh();
  return ok(null);
}

/** Campo vazio = volta a ser categoria (sai de dentro da outra). */
const optionalId = z.preprocess((v) => (v === '' || v == null ? null : v), z.uuid().nullable());
const moveInput = z.object({ id: z.uuid(), parentId: optionalId });

/** "Transformar em subcategoria de…" / "Transformar em categoria": não mexe em nenhum lançamento (D74). */
export async function moveCategoryAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = moveInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail('Escolha a categoria.');
  const r = await runAction(async () =>
    moveCategory(await getServiceCtx(), parsed.data.id, parsed.data.parentId),
  );
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
