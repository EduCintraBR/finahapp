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
  checkStockLot,
  countStockLot,
  createStockCategory,
  archiveStockPerson,
  createStockLocation,
  createStockPerson,
  createStockProduct,
  createSuggestedStockCategories,
  createSuggestedStockPeople,
  openStockLot,
  renameStockCategory,
  renameStockLocation,
  renameStockPerson,
  repackStock,
  updateStockLot,
  updateStockProduct,
  consumeStock,
} from '@/server/stock';
import {
  idInput,
  stockCategoryInput,
  stockCheckInput,
  stockCountInput,
  stockLocationInput,
  stockLotInput,
  stockLotUpdateInput,
  stockOpenInput,
  stockPersonInput,
  stockProductInput,
  stockRenameInput,
  stockRepackInput,
  stockUseInput,
} from '@/server/stock-schemas';

type Prev = ActionResult<null> | null;
const refresh = () => revalidatePath('/casa', 'layout');
const form = (fd: FormData) => Object.fromEntries(fd);

/** O formulário do produto: os campos "person" repetidos viram a lista de "para quem" (D89). */
function productForm(fd: FormData) {
  const { person: _person, ...rest } = Object.fromEntries(fd);
  return { ...rest, personIds: fd.getAll('person').map(String) };
}

/** Valida, roda o serviço e atualiza as telas da Casa; erro vira resposta, nunca exceção. */
async function act<S extends z.ZodType, T>(
  schema: S,
  fd: FormData,
  run: (input: z.output<S>) => Promise<T>,
  read: (fd: FormData) => unknown = form,
): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(read(fd));
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

// ─────────── pessoas e bichos (D89) ───────────

export async function createSuggestedStockPeopleAction(_p: Prev, _fd: FormData): Promise<ActionResult<null>> {
  const r = await runAction(async () => createSuggestedStockPeople(await getServiceCtx()));
  if (r.ok) refresh();
  return done(r);
}

export async function createStockPersonAction(_p: Prev, fd: FormData) {
  return done(await act(stockPersonInput, fd, async (i) => createStockPerson(await getServiceCtx(), i.name)));
}

export async function renameStockPersonAction(_p: Prev, fd: FormData) {
  return done(
    await act(stockRenameInput, fd, async (i) => renameStockPerson(await getServiceCtx(), i.id, i.name)),
  );
}

export async function archiveStockPersonAction(_p: Prev, fd: FormData) {
  return done(await act(idInput, fd, async (i) => archiveStockPerson(await getServiceCtx(), i.id)));
}

// ─────────── produtos ───────────

/** Produto novo segue direto para a 1ª entrada dele. */
export async function createStockProductAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const r = await act(
    stockProductInput,
    fd,
    async (i) => createStockProduct(await getServiceCtx(), i),
    productForm,
  );
  if (!r.ok) return r;
  redirect(`/casa/entrada?produto=${r.data.id}`);
}

const productUpdate = z.object({ id: z.uuid() });

export async function updateStockProductAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const id = productUpdate.safeParse(form(fd));
  if (!id.success) return fail('Produto inválido.');
  const r = await act(
    stockProductInput,
    fd,
    async (i) => updateStockProduct(await getServiceCtx(), id.data.id, i),
    productForm,
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

// ─────────── envase e conferência (D84, D85) ───────────

/** Os campos "source:<lote>" do formulário viram a lista de origens do envase. */
function repackForm(fd: FormData) {
  const sources: { lotId: string; packages: string }[] = [];
  const rest: Record<string, FormDataEntryValue> = {};
  for (const [k, v] of fd) {
    if (k.startsWith('source:'))
      sources.push({ lotId: k.slice('source:'.length), packages: String(v || '0') });
    else rest[k] = v;
  }
  return { ...rest, sources };
}

/** Envasar: abre o lote novo, com o código e as etiquetas para imprimir. */
export async function repackStockAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = stockRepackInput.safeParse(repackForm(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => repackStock(await getServiceCtx(), parsed.data));
  if (!r.ok) return r;
  refresh();
  redirect(`/casa/lotes/${r.data.id}`);
}

/** Abri (D90): abre o lote novo (o aberto) e segue para ele. */
export async function openStockLotAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const r = await act(stockOpenInput, fd, async (i) => openStockLot(await getServiceCtx(), i));
  if (!r.ok) return r;
  redirect(`/casa/lotes/${r.data.id}`);
}

export async function checkStockLotAction(_p: Prev, fd: FormData) {
  return done(await act(stockCheckInput, fd, async (i) => checkStockLot(await getServiceCtx(), i)));
}
