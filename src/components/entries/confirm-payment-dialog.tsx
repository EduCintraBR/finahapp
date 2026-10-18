'use client';

import { useActionState, useState } from 'react';
import { confirmPaymentAction } from '@/app/(app)/lancamentos/actions';
import { Field, FormError, MoneyInput } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/** "Confirmar pagamento" (baixa): data e valor reais, pré-preenchidos com hoje e o estimado. */
export function ConfirmPaymentDialog({
  id,
  version,
  description,
  income,
  amountText,
  today,
  trigger,
}: {
  id: string;
  version: number;
  description: string;
  income: boolean;
  amountText: string;
  today: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof confirmPaymentAction>> | null, fd: FormData) => {
      const r = await confirmPaymentAction(prev, fd);
      if (r.ok) setOpen(false);
      return r;
    },
    null,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            {income ? 'Recebi' : 'Paguei'}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{income ? 'Confirmar recebimento' : 'Confirmar pagamento'}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={version} />
          <Field label={income ? 'Valor recebido' : 'Valor pago'} htmlFor={`amount-${id}`}>
            <MoneyInput id={`amount-${id}`} name="amount" required defaultValue={amountText} />
          </Field>
          <Field label="Data" htmlFor={`date-${id}`}>
            <Input id={`date-${id}`} name="date" type="date" required defaultValue={today} />
          </Field>
          <FormError message={state && !state.ok ? state.error : null} />
          <DialogFooter>
            <Button type="submit" className="h-11 w-full sm:w-auto" disabled={pending}>
              {pending ? 'Confirmando…' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
