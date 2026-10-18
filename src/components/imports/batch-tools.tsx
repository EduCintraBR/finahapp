'use client';

import { useActionState } from 'react';
import {
  acceptAccountLineAction,
  acceptLineAction,
  ignoreSelectedAction,
  refreshSuggestionsAction,
} from '@/app/(app)/importacoes/actions';
import { FormError } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import type { LineCandidate } from '@/db/queries/imports';
import { formatDateBR } from '@/domain/dates';

const BULK_FORM = 'bulk-ignore-form';

/** Caixa de seleção de uma linha: pertence ao formulário de ignorar em lote, mesmo estando fora dele. */
export function LineCheckbox({ lineId }: { lineId: string }) {
  return (
    <input
      type="checkbox"
      name="lineId"
      value={lineId}
      form={BULK_FORM}
      aria-label="Marcar esta linha"
      className="mt-1 size-4 shrink-0 accent-primary"
    />
  );
}

function setAll(checked: boolean) {
  document
    .querySelectorAll<HTMLInputElement>(`input[type=checkbox][name=lineId][form=${BULK_FORM}]`)
    .forEach((el) => (el.checked = checked));
}

/**
 * Ignorar em lote: as marcadas, ou (cartão adicional, onde a fatura é do titular) todas menos as marcadas.
 */
export function BulkIgnoreBar({
  batchId,
  pending,
  additionalCard,
}: {
  batchId: string;
  pending: number;
  additionalCard: boolean;
}) {
  const [state, action, busy] = useActionState(ignoreSelectedAction, null);
  if (pending < 2) return null;
  return (
    <form id={BULK_FORM} action={action} className="space-y-2 rounded-md border border-dashed p-3 text-sm">
      <input type="hidden" name="batchId" value={batchId} />
      <p className="text-muted-foreground">
        {additionalCard
          ? 'Esta é a fatura do titular do cartão adicional: marque (☑) só as compras do casal e ignore o resto de uma vez.'
          : 'Marque (☑) as linhas que não quer lançar para ignorá-las de uma vez.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setAll(true)}>
          Marcar todas
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setAll(false)}>
          Limpar
        </Button>
        <Button type="submit" name="mode" value="SELECTED" size="sm" variant="outline" disabled={busy}>
          Ignorar as marcadas
        </Button>
        {additionalCard && (
          <Button
            type="submit"
            name="mode"
            value="EXCEPT"
            size="sm"
            disabled={busy}
            onClick={(e) => {
              if (!window.confirm('Ignorar TODAS as linhas pendentes, menos as marcadas?'))
                e.preventDefault();
            }}
          >
            Ignorar todas menos as marcadas
          </Button>
        )}
      </div>
      {state?.ok && <p className="text-income">{state.data} linhas ignoradas.</p>}
      <FormError message={state && !state.ok ? state.error : null} />
    </form>
  );
}

/** Recalcula as sugestões (ex.: depois de importar a fatura/o extrato que contém o outro lado do pagamento). */
export function RefreshSuggestionsButton({
  batchId,
  kind,
}: {
  batchId: string;
  kind: 'BANK_STATEMENT' | 'CARD_STATEMENT';
}) {
  const [state, action, busy] = useActionState(refreshSuggestionsAction, null);
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="kind" value={kind} />
      <Button type="submit" size="sm" variant="ghost" disabled={busy}>
        {busy ? 'Procurando…' : 'Atualizar sugestões'}
      </Button>
      <FormError message={state && !state.ok ? state.error : null} />
    </form>
  );
}

/** "Trocar match": outros lançamentos de mesmo valor que ainda não têm par; o usuário escolhe o certo. */
export function CandidatePicker({
  lineId,
  candidates,
  bank,
  hasSuggestion,
}: {
  lineId: string;
  candidates: LineCandidate[];
  bank: boolean;
  hasSuggestion: boolean;
}) {
  const [state, action, busy] = useActionState(bank ? acceptAccountLineAction : acceptLineAction, null);
  if (candidates.length === 0) return null;
  return (
    <details className="rounded-md border text-sm">
      <summary className="cursor-pointer px-3 py-2 text-muted-foreground">
        {hasSuggestion
          ? 'Não é esse? Trocar por outro lançamento'
          : 'Conciliar com um lançamento que já existe'}{' '}
        ({candidates.length})
      </summary>
      <ul className="divide-y border-t">
        {candidates.map((c) => (
          <li key={c.id} className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate">{c.label}</div>
              <div className="text-xs text-muted-foreground">
                {formatDateBR(c.date)} · {c.detail}
              </div>
            </div>
            <form action={action}>
              <input type="hidden" name="id" value={lineId} />
              <input type="hidden" name="candidateId" value={c.id} />
              <Button type="submit" size="sm" variant="outline" disabled={busy}>
                Usar este
              </Button>
            </form>
          </li>
        ))}
      </ul>
      <FormError message={state && !state.ok ? state.error : null} />
    </details>
  );
}
