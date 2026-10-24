'use client';

import { type FormEvent, startTransition, useActionState, useState } from 'react';
import { invoiceDatesAction, payInvoiceAction } from '@/app/(app)/cartoes/actions';
import { Field, FormError, MoneyInput, NativeSelect } from '@/components/forms/fields';
import { FundingFields } from '@/components/forms/funding-fields';
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
import type { ActionResult } from '@/lib/action-result';

/** "Pagar fatura": sugere o que falta pagar (total por padrão); parcial é permitido (D25). */
export function PayInvoiceDialog({
  invoiceId,
  label,
  amountText,
  today,
  additionalHolder,
}: {
  invoiceId: string;
  label: string;
  amountText: string;
  today: string;
  additionalHolder: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (prev: ActionResult<null> | null, fd: FormData) => {
    const r = await payInvoiceAction(prev, fd);
    if (r.ok) setOpen(false);
    return r;
  }, null);
  // onSubmit (e não <form action>): o React não limpa o formulário quando o servidor pede o aporte
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
  const fundingShort = state && !state.ok ? state.details?.fundingShortCents : undefined;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="w-full sm:w-auto">Pagar fatura</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pagar fatura</DialogTitle>
          <DialogDescription>
            {label}
            {additionalHolder && ` · Pix para ${additionalHolder}`} · sai da conta principal
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <input type="hidden" name="id" value={invoiceId} />
          <Field
            label="Valor pago"
            htmlFor={`pay-${invoiceId}`}
            hint="Sugestão: o que falta pagar. Pode pagar só uma parte."
          >
            <MoneyInput id={`pay-${invoiceId}`} name="amount" required defaultValue={amountText} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data" htmlFor={`paydate-${invoiceId}`}>
              <Input id={`paydate-${invoiceId}`} name="date" type="date" required defaultValue={today} />
            </Field>
            <Field label="Como" htmlFor={`paymethod-${invoiceId}`}>
              <NativeSelect id={`paymethod-${invoiceId}`} name="paymentMethod" defaultValue="PIX">
                <option value="PIX">Pix</option>
                <option value="BOLETO">Boleto</option>
                <option value="AUTO_DEBIT">Débito automático</option>
                <option value="BANK_TRANSFER">Transferência</option>
                <option value="OTHER">Outro</option>
              </NativeSelect>
            </Field>
          </div>
          {fundingShort !== undefined && (
            <FundingFields shortCents={fundingShort} idPrefix={`inv-${invoiceId}`} />
          )}
          <FormError message={state && !state.ok ? state.error : null} />
          <DialogFooter>
            <Button type="submit" className="h-11 w-full sm:w-auto" disabled={pending}>
              {pending ? 'Pagando…' : 'Confirmar pagamento'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Datas reais da fatura (D27): mudar o fechamento realoca as compras afetadas. */
export function InvoiceDatesForm({
  invoiceId,
  closingDate,
  dueDate,
  closingEditable,
}: {
  invoiceId: string;
  closingDate: string;
  dueDate: string;
  closingEditable: boolean;
}) {
  const [state, action, pending] = useActionState(invoiceDatesAction, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={invoiceId} />
      {!closingEditable && <input type="hidden" name="closingDate" value={closingDate} />}
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Fechamento"
          htmlFor="inv-closing"
          hint={closingEditable ? undefined : 'Fatura já fechou'}
        >
          <Input
            id="inv-closing"
            name={closingEditable ? 'closingDate' : undefined}
            type="date"
            required
            disabled={!closingEditable}
            defaultValue={closingDate}
          />
        </Field>
        <Field label="Vencimento" htmlFor="inv-due" hint="No mesmo mês">
          <Input id="inv-due" name="dueDate" type="date" required defaultValue={dueDate} />
        </Field>
      </div>
      <FormError message={state && !state.ok ? state.error : null} />
      {state?.ok && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Datas atualizadas.
          {state.data.moved.length > 0 &&
            ` Compras realocadas: ${state.data.moved
              .map(
                (m) =>
                  `${m.description} (${m.direction === 'forward' ? 'para a próxima fatura' : 'para esta fatura'})`,
              )
              .join(', ')}.`}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Salvando…' : 'Salvar datas'}
      </Button>
    </form>
  );
}
