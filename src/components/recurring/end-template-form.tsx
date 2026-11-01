'use client';

import { useActionState } from 'react';
import { endTemplateAction } from '@/app/(app)/fixos/actions';
import { Field, FormError } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { useActionDone } from '@/components/ui/sheet-action';
import { Input } from '@/components/ui/input';

/** Encerrar: escolhe o último mês com conta. Pendentes depois dele são canceladas. */
export function EndTemplateForm({ id, defaultMonth }: { id: string; defaultMonth: string }) {
  const [state, action, pending] = useActionState(endTemplateAction, null);
  useActionDone(state, 'Fixo encerrado.');
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Field
        label="Último mês"
        htmlFor="lastMonth"
        hint="As contas pendentes depois desse mês são canceladas. As já pagas ficam."
      >
        <Input id="lastMonth" name="lastMonth" type="month" required defaultValue={defaultMonth} />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" variant="destructive" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Encerrando…' : 'Encerrar'}
      </Button>
    </form>
  );
}
