'use client';

import { type FormEvent, startTransition, useActionState, useState } from 'react';
import { invoiceDatesAction, payInvoiceAction } from '@/app/(app)/cartoes/actions';
import { Field, FormError, MoneyInput, NativeSelect } from '@/components/forms/fields';
import { FundingFields } from '@/components/forms/funding-fields';
import { Button } from '@/components/ui/button';
import { useActionDone } from '@/components/ui/sheet-action';
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
import { addDays, formatDateBR, isISODate } from '@/domain/dates';
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

/**
 * Datas reais da fatura (D27): mudar o fechamento realoca as compras afetadas. No crediário (D73), o vencimento
 * escolhido pode valer também para as faturas seguintes: todas passam a vencer nesse dia e a fechar alguns dias antes.
 */
export function InvoiceDatesForm({
  invoiceId,
  closingDate,
  dueDate,
  closingEditable,
  storeCredit,
}: {
  invoiceId: string;
  closingDate: string;
  dueDate: string;
  closingEditable: boolean;
  /** crediário e fatura ainda não paga: dias entre o fechamento e o vencimento do cadastro */
  storeCredit?: { closeBeforeDays: number };
}) {
  const [state, action, pending] = useActionState(invoiceDatesAction, null);
  const [due, setDue] = useState(dueDate);
  const [all, setAll] = useState(Boolean(storeCredit));
  useActionDone(
    state,
    state?.ok
      ? `Datas atualizadas.${
          state.data.moved.length > 0
            ? ` Compras realocadas: ${state.data.moved
                .map(
                  (m) =>
                    `${m.description} (${m.direction === 'forward' ? 'para a próxima fatura' : 'para esta fatura'})`,
                )
                .join(', ')}.`
            : ''
        }`
      : undefined,
  );
  const validDue = isISODate(due);
  // no modo "próximas faturas" o fechamento é calculado pelo servidor; aqui só para mostrar
  const closing =
    all && storeCredit && validDue && closingEditable
      ? addDays(due, -storeCredit.closeBeforeDays)
      : closingDate;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={invoiceId} />
      {(!closingEditable || all) && <input type="hidden" name="closingDate" value={closing} />}
      {all && storeCredit ? (
        <Field label="Vencimento" htmlFor="inv-due" hint="No mesmo mês desta fatura">
          <Input
            id="inv-due"
            name="dueDate"
            type="date"
            required
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </Field>
      ) : (
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
            <Input
              id="inv-due"
              name="dueDate"
              type="date"
              required
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </Field>
        </div>
      )}
      {storeCredit && (
        <div className="space-y-1.5 rounded-lg border px-3 py-2.5 text-sm">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              name="applyToNext"
              value="on"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="font-medium">Valer também para as próximas faturas</span>
              <span className="block text-xs text-muted-foreground">
                As faturas abertas e futuras vencem no mesmo dia, e as novas também.
              </span>
            </span>
          </label>
          {all && validDue && (
            <p className="pl-7 text-xs text-muted-foreground" data-testid="due-day-summary">
              Vencem todo dia {Number(due.slice(8))}
              {closingEditable
                ? ` e fecham ${storeCredit.closeBeforeDays} dias antes (esta fatura fecha em ${formatDateBR(closing)}).`
                : ' (esta fatura já fechou: só o vencimento muda).'}
            </p>
          )}
        </div>
      )}
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" variant="outline" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Salvando…' : 'Salvar datas'}
      </Button>
    </form>
  );
}
