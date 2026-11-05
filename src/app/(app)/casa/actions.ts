'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { type ActionResult, fail, ok } from '@/lib/action-result';
import { runAction } from '@/server/context';
import { firstIssue } from '@/server/schemas';
import { getServiceCtx } from '@/server/session';
import {
  addStockLot,
  archiveStockCategory,
  archiveStockLocation,
  archiveStockProduct,
  cancelStockMovement,
  countStockLot,
  createStockCategory,
  createStockLocation,
  createStockProduct,
  createSuggestedStockCategories,
  renameStockCategory,
  renameStockLocation,
  updateStockLot,
  updateStockProduct,
  consumeStock,
} from '@/server/stock';
import {
  idInput,
  stockCategoryInput,
  stockCountInput,
  stockLocationInput,
  stockLotInput,
  stockLotUpdateInput,
  stockProductInput,
  stockRenameInput,
  stockUseInput,
} from '@/server/stock-schemas';

type Prev = ActionResult<null> | null;
const refresh = () => revalidatePath('/casa', 'layout');
const form = (fd: FormData) => Object.fromEntries(fd);

/** Valida, roda o serviço e atualiza as telas da Casa; erro vira resposta, nunca exceção. */
async function act<S extends z.ZodType, T>(
  schema: S,
  fd: FormData,
  run: (input: z.output<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(form(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(() => run(parsed.data));
  if (r.ok) refresh();
  return r;
}

const done = <T>(r: ActionResult<T>): ActionResult<null> => (r.ok ? ok(null) : r);

// ─────────── categorias e locais ───────────

export async function createSuggestedStockCategoriesAction(
  _p: Prev,
  _fd: FormData,
): Promise<ActionResult<null>> {
  const r = await runAction(async () => createSuggestedStockCategories(await getServiceCtx()));
  if (r.ok) refresh();
  return done(r);
}

export async function createStockCategoryAction(_p: Prev, fd: FormData) {
  return done(await act(stockCategoryInput, fd, async (i) => createStockCategory(await getServiceCtx(), i)));
}

export async function renameStockCategoryAction(_p: Prev, fd: FormData) {
  return done(
    await act(stockRenameInput, fd, async (i) => renameStockCategory(await getServiceCtx(), i.id, i.name)),
  );
}

export async function archiveStockCategoryAction(_p: Prev, fd: FormData) {
  return done(await act(idInput, fd, async (i) => archiveStockCategory(await getServiceCtx(), i.id)));
}

export async function createStockLocationAction(_p: Prev, fd: FormData) {
  return done(
    await act(stockLocationInput, fd, async (i) => createStockLocation(await getServiceCtx(), i.name)),
  );
}

export async function renameStockLocationAction(_p: Prev, fd: FormData) {
  return done(
    await act(stockRenameInput, fd, async (i) => renameStockLocation(await getServiceCtx(), i.id, i.name)),
  );
}

export async function archiveStockLocationAction(_p: Prev, fd: FormData) {
  return done(await act(idInput, fd, async (i) => archiveStockLocation(await getServiceCtx(), i.id)));
}

// ─────────── produtos ───────────

/** Produto novo segue direto para a 1ª entrada dele. */
export async function createStockProductAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const r = await act(stockProductInput, fd, async (i) => createStockProduct(await getServiceCtx(), i));
  if (!r.ok) return r;
  redirect(`/casa/entrada?produto=${r.data.id}`);
}

const productUpdate = z.object({ id: z.uuid() });

export async function updateStockProductAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const id = productUpdate.safeParse(form(fd));
  if (!id.success) return fail('Produto inválido.');
  const r = await act(stockProductInput, fd, async (i) =>
    updateStockProduct(await getServiceCtx(), id.data.id, i),
  );
  if (!r.ok) return r;
  redirect(`/casa/produtos/${id.data.id}`);
}

export async function archiveStockProductAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const r = await act(idInput, fd, async (i) => archiveStockProduct(await getServiceCtx(), i.id));
  if (!r.ok) return r;
  redirect('/casa/estoque');
}

// ─────────── lotes e movimentos ───────────

/** Entrada: da tela do produto, fica nela (o painel fecha); da tela "Dar entrada", vai para o produto. */
export async function addStockLotAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const r = await act(stockLotInput, fd, async (i) => addStockLot(await getServiceCtx(), i));
  if (!r.ok) return r;
  if (fd.get('voltar') === 'produto') redirect(`/casa/produtos/${String(fd.get('productId'))}`);
  return ok(null);
}

export async function updateStockLotAction(_p: Prev, fd: FormData) {
  return done(await act(stockLotUpdateInput, fd, async (i) => updateStockLot(await getServiceCtx(), i)));
}

export async function useStockAction(_p: Prev, fd: FormData) {
  return done(await act(stockUseInput, fd, async (i) => consumeStock(await getServiceCtx(), i)));
}

export async function countStockLotAction(_p: Prev, fd: FormData) {
  return done(await act(stockCountInput, fd, async (i) => countStockLot(await getServiceCtx(), i)));
}

export async function cancelStockMovementAction(_p: Prev, fd: FormData) {
  return done(await act(idInput, fd, async (i) => cancelStockMovement(await getServiceCtx(), i.id)));
}
