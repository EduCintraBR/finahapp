'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { type ActionResult, fail, ok } from '@/lib/action-result';
import { runAction } from '@/server/context';
import {
  acceptAllSuggestions,
  acceptMatch,
  type BatchCreateResult,
  createAllNew,
  createFromLine,
  ignoreLine,
  importCardStatement,
} from '@/server/imports';
import { firstIssue, money } from '@/server/schemas';
import {
  type AccountBatchResult,
  acceptAccountMatch,
  acceptAllAccountSuggestions,
  createAllNewAccountLines,
  createFromAccountLine,
  importAccountStatement,
} from '@/server/account-imports';
import { getServiceCtx } from '@/server/session';

type Prev<T = null> = ActionResult<T> | null;
const refresh = () => revalidatePath('/', 'layout');
const id = (fd: FormData, key = 'id') => String(fd.get(key) ?? '');

export async function uploadStatementAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return fail('Escolha o arquivo OFX da fatura.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = await runAction(async () =>
    importCardStatement(await getServiceCtx(), { cardId: id(fd, 'cardId'), fileName: file.name, bytes }),
  );
  if (!r.ok) return r;
  refresh();
  redirect(`/importacoes/${r.data.batchId}`);
}

export async function acceptLineAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const r = await runAction(async () => acceptMatch(await getServiceCtx(), id(fd)));
  if (r.ok) refresh();
  return r.ok ? ok(null) : r;
}

export async function ignoreLineAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const r = await runAction(async () => ignoreLine(await getServiceCtx(), id(fd)));
  if (r.ok) refresh();
  return r.ok ? ok(null) : r;
}

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const createLineInput = z.object({
  description: z.string().trim().min(1, { error: 'Informe uma descrição.' }).max(180),
  categoryId: z.uuid({ error: 'Escolha uma categoria.' }),
  beneficiaryUserId: z.preprocess(blank, z.uuid().optional()).transform((v) => v ?? null),
  total: z
    .preprocess(blank, money({ positive: true, label: 'o total da compra' }).optional())
    .transform((v) => v ?? null),
  paymentTarget: z.preprocess(blank, z.enum(['THIS', 'PREVIOUS']).optional()).transform((v) => v ?? null),
});

export async function createLineAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = createLineInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => createFromLine(await getServiceCtx(), id(fd), parsed.data));
  if (r.ok) refresh();
  return r.ok ? ok(null) : r;
}

export async function acceptAllAction(_p: Prev<number>, fd: FormData): Promise<ActionResult<number>> {
  const r = await runAction(async () => acceptAllSuggestions(await getServiceCtx(), id(fd, 'batchId')));
  if (r.ok) refresh();
  return r;
}

export async function createAllAction(
  _p: Prev<BatchCreateResult>,
  fd: FormData,
): Promise<ActionResult<BatchCreateResult>> {
  const r = await runAction(async () => createAllNew(await getServiceCtx(), id(fd, 'batchId')));
  if (r.ok) refresh();
  return r;
}

// ─────────── extrato da conta (D44–D47) ───────────

export async function uploadAccountStatementAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return fail('Escolha o arquivo OFX do extrato.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = await runAction(async () =>
    importAccountStatement(await getServiceCtx(), { fileName: file.name, bytes }),
  );
  if (!r.ok) return r;
  refresh();
  redirect(`/importacoes/${r.data.batchId}`);
}

export async function acceptAccountLineAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const r = await runAction(async () => acceptAccountMatch(await getServiceCtx(), id(fd)));
  if (r.ok) refresh();
  return r.ok ? ok(null) : r;
}

const createAccountLineInput = z
  .object({
    kind: z.enum(['EXPENSE', 'INCOME', 'TRANSFER', 'INVOICE_PAYMENT'], { error: 'Escolha o tipo.' }),
    description: z.string().trim().min(1, { error: 'Informe uma descrição.' }).max(180),
    categoryId: z.preprocess(blank, z.uuid().optional()).transform((v) => v ?? null),
    beneficiaryUserId: z.preprocess(blank, z.uuid().optional()).transform((v) => v ?? null),
    invoiceId: z.preprocess(blank, z.uuid().optional()).transform((v) => v ?? null),
  })
  .refine((v) => !(v.kind === 'EXPENSE' || v.kind === 'INCOME') || v.categoryId, {
    error: 'Escolha uma categoria.',
  })
  .refine((v) => v.kind !== 'INVOICE_PAYMENT' || v.invoiceId, { error: 'Escolha a fatura paga.' });

export async function createAccountLineAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const parsed = createAccountLineInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const r = await runAction(async () => createFromAccountLine(await getServiceCtx(), id(fd), parsed.data));
  if (r.ok) refresh();
  return r.ok ? ok(null) : r;
}

export async function acceptAllAccountAction(_p: Prev<number>, fd: FormData): Promise<ActionResult<number>> {
  const r = await runAction(async () =>
    acceptAllAccountSuggestions(await getServiceCtx(), id(fd, 'batchId')),
  );
  if (r.ok) refresh();
  return r;
}

export async function createAllAccountAction(
  _p: Prev<AccountBatchResult>,
  fd: FormData,
): Promise<ActionResult<AccountBatchResult>> {
  const r = await runAction(async () => createAllNewAccountLines(await getServiceCtx(), id(fd, 'batchId')));
  if (r.ok) refresh();
  return r;
}
