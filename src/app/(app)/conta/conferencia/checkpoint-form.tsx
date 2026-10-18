'use client';

import { useActionState, useState, useTransition } from 'react';
import { Field, FormError, MoneyInput } from '@/components/forms/fields';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatBRL } from '@/domain/money';
import { checkpointAction, previewBalanceAction } from './actions';

/**
 * 1) informa a data e o saldo do banco → 2) vê o calculado e a diferença → 3) registra,
 * lançando (ou não) o ajuste. A diferença final é calculada no servidor, em centavos.
 */
export function CheckpointForm({ today }: { today: string }) {
  const [date, setDate] = useState(today);
  const [computed, setComputed] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();
  const [state, action, pending] = useActionState(checkpointAction, null);

  const preview = (d: string) =>
    startPreview(async () => {
      const r = await previewBalanceAction(d);
      setComputed(r.ok ? r.data : null);
      setPreviewError(r.ok ? null : r.error);
    });

  if (state?.ok) {
    const { statementCents, computedCents, adjustmentTransactionId } = state.data;
    const diff = statementCents - computedCents;
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium">Conferência registrada.</p>
        {diff === 0 ? (
          <p>O saldo do app bate com o banco. 👌</p>
        ) : adjustmentTransactionId ? (
          <p>
            Lançamos um ajuste de <Amount cents={Math.abs(diff)} direction={diff > 0 ? 'in' : 'out'} /> para o
            saldo bater com o banco.
          </p>
        ) : (
          <p>
            Diferença de {formatBRL(diff)} registrada, sem ajuste. Procure o lançamento que falta ou sobra.
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data" htmlFor="cp-date">
          <Input
            id="cp-date"
            name="date"
            type="date"
            required
            max={today}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setComputed(null);
            }}
          />
        </Field>
        <Field label="Saldo no banco" htmlFor="cp-statement">
          <MoneyInput id="cp-statement" name="statementBalance" required />
        </Field>
      </div>

      {computed === null ? (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={previewing}
          onClick={() => preview(date)}
        >
          {previewing ? 'Calculando…' : 'Ver saldo do app nessa data'}
        </Button>
      ) : (
        <div className="space-y-3 rounded-lg bg-muted p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Saldo do app em {date.split('-').reverse().join('/')}
            </span>
            <Amount cents={computed} className="font-medium" />
          </div>
          <p className="text-xs text-muted-foreground">
            Se o banco mostrar outro valor, o app lança um ajuste com a diferença exata nessa data.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" name="applyAdjustment" value="true" disabled={pending} className="flex-1">
              Registrar e ajustar se precisar
            </Button>
            <Button
              type="submit"
              name="applyAdjustment"
              value="false"
              variant="outline"
              disabled={pending}
              className="flex-1"
            >
              Só registrar
            </Button>
          </div>
        </div>
      )}
      <FormError message={previewError ?? (state && !state.ok ? state.error : null)} />
    </form>
  );
}
