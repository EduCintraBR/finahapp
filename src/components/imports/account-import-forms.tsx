'use client';

import { useActionState, useState } from 'react';
import {
  acceptAccountLineAction,
  acceptAllAccountAction,
  createAccountLineAction,
  createAllAccountAction,
  ignoreLineAction,
  uploadAccountStatementAction,
} from '@/app/(app)/importacoes/actions';
import { Field, FormError, NativeSelect } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CategoryOption, UserOption } from '@/db/queries/lookups';
import { formatMonthLabel } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import type { AccountLineKind } from '@/importers/nubank-account';

export function UploadAccountStatementForm() {
  const [state, action, pending] = useActionState(uploadAccountStatementAction, null);
  return (
    <form action={action} className="space-y-3">
      <Field
        label="Arquivo OFX do extrato"
        htmlFor="ofx-account-file"
        hint="No app do Nubank: Conta → Extrato → Exportar → período → OFX."
      >
        <Input
          id="ofx-account-file"
          name="file"
          type="file"
          accept=".ofx,application/x-ofx,text/plain"
          required
        />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending ? 'Lendo o arquivo…' : 'Importar e revisar'}
      </Button>
    </form>
  );
}

export type AccountLineView = {
  id: string;
  direction: 'IN' | 'OUT';
  description: string;
  suggestedKind: AccountLineKind;
  suggestedCategoryId: string | null;
  suggestion: { label: string; pending: boolean } | null;
};

export type InvoiceOption = { id: string; cardName: string; referenceMonth: string; remainingCents: number };

const KIND_OPTIONS: Record<'IN' | 'OUT', { value: AccountLineKind; label: string }[]> = {
  OUT: [
    { value: 'EXPENSE', label: 'Despesa' },
    { value: 'TRANSFER', label: 'Transferência (conta própria / investimento)' },
    { value: 'INVOICE_PAYMENT', label: 'Pagamento de fatura' },
  ],
  IN: [
    { value: 'INCOME', label: 'Receita' },
    { value: 'TRANSFER', label: 'Transferência (conta própria / investimento)' },
  ],
};

/** Ações de uma linha do extrato: aceitar a sugestão (dá baixa se pendente), criar ou ignorar. */
export function AccountLineActions({
  line,
  categories,
  users,
  invoices,
}: {
  line: AccountLineView;
  categories: CategoryOption[];
  users: UserOption[];
  invoices: InvoiceOption[];
}) {
  const [accepting, accept, acceptPending] = useActionState(acceptAccountLineAction, null);
  const [ignoring, ignore, ignorePending] = useActionState(ignoreLineAction, null);
  const [creating, create, createPending] = useActionState(createAccountLineAction, null);
  const [showCreate, setShowCreate] = useState(!line.suggestion);
  const [kind, setKind] = useState<AccountLineKind>(line.suggestedKind);
  const busy = acceptPending || ignorePending || createPending;
  const error = [accepting, ignoring, creating].find((s) => s && !s.ok);
  const catKind = kind === 'INCOME' ? 'INCOME' : 'EXPENSE';
  const fallbackName = catKind === 'INCOME' ? 'Outras receitas' : 'A classificar';
  const defaultCategory =
    (kind === line.suggestedKind ? line.suggestedCategoryId : null) ??
    categories.find((c) => c.kind === catKind && c.name === fallbackName)?.id ??
    '';

  return (
    <div className="space-y-3">
      {line.suggestion && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-income/10 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            {line.suggestion.pending ? 'Conta pendente: ' : 'Já lançado: '}
            <span className="font-medium">{line.suggestion.label}</span>
            {line.suggestion.pending && ' (recebe a baixa)'}
          </span>
          <form action={accept}>
            <input type="hidden" name="id" value={line.id} />
            <Button type="submit" size="sm" disabled={busy}>
              É esse
            </Button>
          </form>
          {!showCreate && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowCreate(true)}>
              Não é esse
            </Button>
          )}
        </div>
      )}

      {showCreate && (
        <form action={create} className="grid grid-cols-2 gap-3 rounded-md border p-3">
          <input type="hidden" name="id" value={line.id} />
          <Field label="Tipo" htmlFor={`kind-${line.id}`} className="col-span-2">
            <NativeSelect
              id={`kind-${line.id}`}
              name="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as AccountLineKind)}
            >
              {KIND_OPTIONS[line.direction].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Descrição" htmlFor={`desc-${line.id}`} className="col-span-2">
            <Input
              id={`desc-${line.id}`}
              name="description"
              required
              maxLength={180}
              defaultValue={kind === 'INVOICE_PAYMENT' ? 'Pagamento de fatura' : line.description}
              key={kind === 'INVOICE_PAYMENT' ? 'inv' : 'other'}
            />
          </Field>
          {(kind === 'EXPENSE' || kind === 'INCOME') && (
            <>
              <Field label="Categoria" htmlFor={`cat-${line.id}`}>
                <NativeSelect
                  id={`cat-${line.id}`}
                  name="categoryId"
                  defaultValue={defaultCategory}
                  key={catKind}
                >
                  {categories
                    .filter((c) => c.kind === catKind)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </NativeSelect>
              </Field>
              <Field label="De quem é" htmlFor={`ben-${line.id}`}>
                <NativeSelect id={`ben-${line.id}`} name="beneficiaryUserId" defaultValue="">
                  <option value="">Casal</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </>
          )}
          {kind === 'TRANSFER' && (
            <p className="col-span-2 text-xs text-muted-foreground">
              Mexe no saldo da conta, mas não conta como gasto nem como receita.
            </p>
          )}
          {kind === 'INVOICE_PAYMENT' && (
            <Field
              label="Pagou qual fatura?"
              htmlFor={`inv-${line.id}`}
              className="col-span-2"
              hint={
                invoices.length === 0
                  ? 'Nenhuma fatura no app: cadastre o cartão primeiro.'
                  : 'Não é gasto: só baixa a fatura e libera o limite.'
              }
            >
              <NativeSelect id={`inv-${line.id}`} name="invoiceId" required defaultValue="">
                <option value="" disabled>
                  Escolha…
                </option>
                {invoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.cardName} · {formatMonthLabel(i.referenceMonth)} · a pagar{' '}
                    {formatBRL(i.remainingCents)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Button type="submit" size="sm" disabled={busy} className="col-span-2 sm:col-span-1">
            {createPending ? 'Criando…' : 'Criar lançamento'}
          </Button>
        </form>
      )}

      <form action={ignore} className="flex justify-end">
        <input type="hidden" name="id" value={line.id} />
        <Button type="submit" size="sm" variant="ghost" disabled={busy}>
          Ignorar linha
        </Button>
      </form>
      {error && !error.ok && <FormError message={error.error} />}
    </div>
  );
}

export function AccountBatchActions({
  batchId,
  suggested,
  fresh,
}: {
  batchId: string;
  suggested: number;
  fresh: number;
}) {
  const [accepted, acceptAll, acceptPending] = useActionState(acceptAllAccountAction, null);
  const [created, createAll, createPending] = useActionState(createAllAccountAction, null);
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        {suggested > 0 && (
          <form action={acceptAll} className="flex-1">
            <input type="hidden" name="batchId" value={batchId} />
            <Button type="submit" className="w-full" disabled={acceptPending}>
              {acceptPending ? 'Conciliando…' : `Aceitar as ${suggested} sugestões`}
            </Button>
          </form>
        )}
        {fresh > 0 && (
          <form action={createAll} className="flex-1">
            <input type="hidden" name="batchId" value={batchId} />
            <Button type="submit" variant="outline" className="w-full" disabled={createPending}>
              {createPending ? 'Criando…' : `Criar as ${fresh} novas`}
            </Button>
          </form>
        )}
      </div>
      {accepted && !accepted.ok && <FormError message={accepted.error} />}
      {created && !created.ok && <FormError message={created.error} />}
      {created?.ok && created.data.skipped.length > 0 && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Criadas {created.data.created}. Faltam revisar uma a uma:{' '}
          {created.data.skipped.map((s) => `${s.description} (${s.reason})`).join('; ')}.
        </p>
      )}
    </div>
  );
}
