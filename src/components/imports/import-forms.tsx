'use client';

import { useActionState, useState } from 'react';
import {
  acceptAllAction,
  acceptLineAction,
  createAllAction,
  createLineAction,
  ignoreLineAction,
  uploadStatementAction,
} from '@/app/(app)/importacoes/actions';
import { Field, FormError, MoneyInput, NativeSelect } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { LineCandidate } from '@/db/queries/imports';
import type { CategoryOption, UserOption } from '@/db/queries/lookups';
import { CandidatePicker } from './batch-tools';
import { formatDateBR } from '@/domain/dates';
import { formatDecimalBR } from '@/domain/money';
import { cn } from '@/lib/utils';

export function UploadStatementForm({ cardId }: { cardId: string }) {
  const [state, action, pending] = useActionState(uploadStatementAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="cardId" value={cardId} />
      <Field
        label="Arquivo da fatura (OFX ou CSV)"
        htmlFor="ofx-file"
        hint="No app do Nubank: fatura → ⋯ → Exportar fatura → OFX (ou CSV)."
      >
        <Input
          id="ofx-file"
          name="file"
          type="file"
          accept=".ofx,.csv,text/csv,application/x-ofx,text/plain"
          required
        />
      </Field>
      <Field
        label="Mês da fatura (só para CSV)"
        htmlFor="ref-month"
        hint="O CSV não informa o período. Use o mês do vencimento: a fatura que vence em 16/11 é a de novembro. No OFX isso é ignorado."
      >
        <Input id="ref-month" name="referenceMonth" type="month" />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending ? 'Lendo o arquivo…' : 'Importar e revisar'}
      </Button>
    </form>
  );
}

export type LineView = {
  id: string;
  kind: 'PURCHASE' | 'INSTALLMENT' | 'PAYMENT' | 'CREDIT';
  description: string;
  amountCents: number;
  installment: { k: number; n: number } | null;
  suggestedCategoryId: string | null;
  paysThisInvoice: boolean | null;
  suggestion: { label: string; date: string | null } | null;
  /** outros lançamentos de mesmo valor que ainda não têm par (trocar match) */
  candidates: LineCandidate[];
  /** compra de antes do início do controle: não dá para criar (D18), só conciliar ou ignorar. ISO do início. */
  blockedBefore: string | null;
};

/** Ações de uma linha pendente: aceitar a sugestão, criar o lançamento ou ignorar. */
export function PendingLineActions({
  line,
  categories,
  users,
  fallbackCategoryId,
  invoiceLabels,
}: {
  line: LineView;
  categories: CategoryOption[];
  users: UserOption[];
  fallbackCategoryId: string;
  invoiceLabels: { this: string; previous: string };
}) {
  const [accepting, accept, acceptPending] = useActionState(acceptLineAction, null);
  const [ignoring, ignore, ignorePending] = useActionState(ignoreLineAction, null);
  const [creating, create, createPending] = useActionState(createLineAction, null);
  const [showCreate, setShowCreate] = useState(!line.suggestion);
  const busy = acceptPending || ignorePending || createPending;
  const firstOfMany = line.kind === 'INSTALLMENT' && line.installment?.k === 1;
  const error = [accepting, ignoring, creating].find((s) => s && !s.ok);

  return (
    <div className="space-y-3">
      {line.suggestion && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-income/10 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            Já lançado: <span className="font-medium">{line.suggestion.label}</span>
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

      <CandidatePicker
        lineId={line.id}
        candidates={line.candidates}
        bank={false}
        hasSuggestion={!!line.suggestion}
      />

      {line.blockedBefore && line.kind !== 'CREDIT' && line.kind !== 'PAYMENT' && (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-sm">
          Compra de antes do início do controle ({formatDateBR(line.blockedBefore)}). Para lançá-la, importe
          antes o extrato da conta desse período (o app recua o início do controle sozinho) e volte aqui; ou
          ignore a linha.
        </p>
      )}

      {showCreate && line.kind !== 'CREDIT' && !(line.blockedBefore && line.kind !== 'PAYMENT') && (
        <form action={create} className="grid grid-cols-2 gap-3 rounded-md border p-3">
          <input type="hidden" name="id" value={line.id} />
          {line.kind === 'PAYMENT' ? (
            <>
              <input type="hidden" name="description" value="Pagamento de fatura" />
              <input type="hidden" name="categoryId" value={fallbackCategoryId} />
              <Field label="Pagou qual fatura?" htmlFor={`target-${line.id}`} className="col-span-2">
                <NativeSelect
                  id={`target-${line.id}`}
                  name="paymentTarget"
                  defaultValue={line.paysThisInvoice === false ? 'PREVIOUS' : 'THIS'}
                >
                  <option value="THIS">{invoiceLabels.this} (adiantamento)</option>
                  <option value="PREVIOUS">{invoiceLabels.previous}</option>
                </NativeSelect>
              </Field>
              <p className="col-span-2 text-xs text-muted-foreground">
                Sai da conta principal na data da linha. Se a fatura anterior não estiver no app, ela recebe o
                saldo correspondente para o limite fechar.
              </p>
            </>
          ) : (
            <>
              <Field label="Descrição" htmlFor={`desc-${line.id}`} className="col-span-2">
                <Input
                  id={`desc-${line.id}`}
                  name="description"
                  required
                  maxLength={180}
                  defaultValue={line.description}
                />
              </Field>
              <Field label="Categoria" htmlFor={`cat-${line.id}`}>
                <NativeSelect
                  id={`cat-${line.id}`}
                  name="categoryId"
                  defaultValue={line.suggestedCategoryId ?? fallbackCategoryId}
                >
                  {categories
                    .filter((c) => c.kind === 'EXPENSE')
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
              {firstOfMany && (
                <Field
                  label="Valor total da compra"
                  htmlFor={`total-${line.id}`}
                  hint={`Confira no app do banco. Sugestão: ${line.installment!.n} × a parcela.`}
                  className="col-span-2"
                >
                  <MoneyInput
                    id={`total-${line.id}`}
                    name="total"
                    required
                    defaultValue={formatDecimalBR(line.amountCents * line.installment!.n)}
                  />
                </Field>
              )}
              {line.kind === 'INSTALLMENT' && !firstOfMany && (
                <p className="col-span-2 text-xs text-muted-foreground">
                  Vira um parcelamento em andamento a partir da parcela {line.installment!.k} de{' '}
                  {line.installment!.n}.
                </p>
              )}
            </>
          )}
          <Button type="submit" size="sm" disabled={busy} className="col-span-2 sm:col-span-1">
            {createPending ? 'Criando…' : line.kind === 'PAYMENT' ? 'Lançar pagamento' : 'Criar lançamento'}
          </Button>
        </form>
      )}

      {line.kind === 'CREDIT' && (
        <p className="text-xs text-muted-foreground">
          Estornos ainda não são criados pela importação: registre na tela da compra (Estorno) e ignore esta
          linha.
        </p>
      )}

      <form
        action={ignore}
        className={cn('flex justify-end', !showCreate && !line.suggestion && 'justify-start')}
      >
        <input type="hidden" name="id" value={line.id} />
        <Button type="submit" size="sm" variant="ghost" disabled={busy}>
          Ignorar linha
        </Button>
      </form>
      {error && !error.ok && <FormError message={error.error} />}
    </div>
  );
}

export function BatchActions({
  batchId,
  suggested,
  fresh,
}: {
  batchId: string;
  suggested: number;
  fresh: number;
}) {
  const [accepted, acceptAll, acceptPending] = useActionState(acceptAllAction, null);
  const [created, createAll, createPending] = useActionState(createAllAction, null);
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
