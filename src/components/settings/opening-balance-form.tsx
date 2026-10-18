'use client';

import { useActionState } from 'react';
import { updateOpeningBalanceAction } from '@/app/(app)/ajustes/actions';
import { Field, FormError, MoneyInput } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDecimalBR } from '@/domain/money';

export function OpeningBalanceForm({ amountCents, date }: { amountCents: number; date: string }) {
  const [state, action, pending] = useActionState(updateOpeningBalanceAction, null);
  return (
    <form action={action} className="grid grid-cols-2 gap-3">
      <Field label="Saldo inicial" htmlFor="ob-amount">
        <MoneyInput id="ob-amount" name="amount" required defaultValue={formatDecimalBR(amountCents)} />
      </Field>
      <Field label="Em" htmlFor="ob-date">
        <Input id="ob-date" name="date" type="date" required defaultValue={date} />
      </Field>
      <p className="col-span-2 text-xs text-muted-foreground">
        Saldo da conta no começo do dia, antes de qualquer lançamento. Mudar aqui recalcula o saldo de todo o
        histórico e fica registrado.
      </p>
      <div className="col-span-2 space-y-2">
        <FormError message={state && !state.ok ? state.error : null} />
        {state?.ok && <p className="text-sm text-income">Saldo inicial atualizado.</p>}
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? 'Salvando…' : 'Salvar saldo inicial'}
        </Button>
      </div>
    </form>
  );
}
