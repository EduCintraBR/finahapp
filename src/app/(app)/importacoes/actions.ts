'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { type ActionResult, fail, ok } from '@/lib/action-result';
import { backfillBlockMessage } from '@/domain/account/backfill';
import { runAction, UserError } from '@/server/context';
import {
  acceptAllSuggestions,
  acceptMatch,
  type BatchCreateResult,
  createAllNew,
  createFromLine,
  ignoreLine,
  ignoreLines,
  importCardStatement,
  refreshSuggestions,
} from '@/server/imports';
import { firstIssue, money } from '@/server/schemas';
import {
  type AccountBatchResult,
  acceptAccountMatch,
  acceptAllAccountSuggestions,
  createAllNewAccountLines,
  createFromAccountLine,
  type AccountBackfillPreview,
  importAccountStatement,
  previewAccountBackfill,
  refreshAccountSuggestions,
} from '@/server/account-imports';
import { getServiceCtx } from '@/server/session';

type Prev<T = null> = ActionResult<T> | null;
const refresh = () => revalidatePath('/', 'layout');
const id = (fd: FormData, key = 'id') => String(fd.get(key) ?? '');
/** "Trocar match": o lançamento escolhido no lugar do sugerido (vazio = o sugerido). */
const candidate = (fd: FormData) => String(fd.get('candidateId') ?? '') || undefined;

export async function uploadStatementAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return fail('Escolha o arquivo da fatura (OFX ou CSV).');
  const bytes = new Uint8Array(await file.arrayBuffer());
  // CSV não traz o período: o mês da fatura vem do formulário ('AAAA-MM')
  const month = String(fd.get('referenceMonth') ?? '');
  const referenceMonth = /^d{4}-(0[1-9]|1[0-2])$/.test(month) ? `${month}-01` : undefined;
  const r = await runAction(async () =>
    importCardStatement(await getServiceCtx(), {
      cardId: id(fd, 'cardId'),
      fileName: file.name,
      bytes,
      referenceMonth,
    }),
  );
  if (!r.ok) return r;
  refresh();
  redirect(`/importacoes/${r.data.batchId}`);
}

export async function acceptLineAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const r = await runAction(async () => acceptMatch(await getServiceCtx(), id(fd), candidate(fd)));
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

/** O arquivo tem lançamentos antes do início do controle: a tela mostra o plano e pede confirmação (D50). */
export type AccountUploadOutcome = { backfill: AccountBackfillPreview };

export async function uploadAccountStatementAction(
  _p: ActionResult<AccountUploadOutcome | null> | null,
  fd: FormData,
): Promise<ActionResult<AccountUploadOutcome | null>> {
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return fail('Escolha o arquivo do extrato (OFX ou CSV).');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const confirmed = fd.get('backfill') === '1';
  const r = await runAction(async () => {
    const ctx = await getServiceCtx();
    if (!confirmed) {
      const preview = await previewAccountBackfill(ctx, { bytes });
      if (preview) {
        const blocked = backfillBlockMessage(preview.plan, preview.oldDate);
        if (blocked) throw new UserError(blocked);
        return { backfill: preview } satisfies AccountUploadOutcome;
      }
    }
    return importAccountStatement(ctx, { fileName: file.name, bytes, backfill: confirmed });
  });
  if (!r.ok) return r;
  if ('backfill' in r.data) return ok(r.data);
  refresh();
  redirect(`/importacoes/${r.data.batchId}`);
}

export async function acceptAccountLineAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const r = await runAction(async () => acceptAccountMatch(await getServiceCtx(), id(fd), candidate(fd)));
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

// ─────────── lote ───────────

export async function ignoreSelectedAction(_p: Prev<number>, fd: FormData): Promise<ActionResult<number>> {
  const mode = fd.get('mode') === 'EXCEPT' ? 'EXCEPT' : 'SELECTED';
  const lineIds = fd.getAll('lineId').map(String);
  const r = await runAction(async () =>
    ignoreLines(await getServiceCtx(), id(fd, 'batchId'), { mode, lineIds }),
  );
  if (r.ok) refresh();
  return r;
}

/** Recalcula as sugestões das linhas pendentes (ex.: depois de importar o outro lado do mesmo pagamento). */
export async function refreshSuggestionsAction(_p: Prev, fd: FormData): Promise<ActionResult<null>> {
  const bank = fd.get('kind') === 'BANK_STATEMENT';
  const r = await runAction(async () => {
    const ctx = await getServiceCtx();
    return bank
      ? refreshAccountSuggestions(ctx, id(fd, 'batchId'))
      : refreshSuggestions(ctx, id(fd, 'batchId'));
  });
  if (r.ok) refresh();
  return r.ok ? ok(null) : r;
}
