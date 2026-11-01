'use client';

import { useActionState, useState } from 'react';
import { anticipateAction, editPurchaseAction, refundAction } from '@/app/(app)/cartoes/actions';
import { CategoryPicker } from '@/components/categories/category-picker';
import { Field, FormError, MoneyInput, NativeSelect } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { useActionDone } from '@/components/ui/sheet-action';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { CategoryOption, UserOption } from '@/db/queries/lookups';
import { formatBRL, formatDecimalBR } from '@/domain/money';
import { cn } from '@/lib/utils';

export type InvoiceOption = { id: string; label: string; open: boolean };
export type AnticipatableOption = { id: string; number: number; amountCents: number; monthLabel: string };

/**
 * Antecipação (§3.5): escolhe parcelas (padrão: a última), informa quanto o banco cobrou;
 * desconto = bruto − pago. Liquidação na fatura (aberta) ou paga avulsa pela conta.
 */
export function AnticipationForm({
  planId,
  count,
  options,
  invoices,
  today,
}: {
  planId: string;
  count: number;
  options: AnticipatableOption[];
  invoices: InvoiceOption[];
  today: string;
}) {
  const [state, action, pending] = useActionState(anticipateAction, null);
  const [selected, setSelected] = useState<string[]>(options.slice(-1).map((o) => o.id));
  const [settlement, setSettlement] = useState<'ON_INVOICE' | 'DIRECT_PAYMENT'>('ON_INVOICE');
  const gross = options.filter((o) => selected.includes(o.id)).reduce((s, o) => s + o.amountCents, 0);
  const openInvoices = invoices.filter((i) => i.open);
  useActionDone(state, 'Antecipação registrada.');

  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma parcela em fatura aberta para antecipar.</p>;
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="planId" value={planId} />
      <fieldset className="space-y-1">
        <legend className="mb-1 text-sm font-medium">Parcelas</legend>
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="itemIds"
              value={o.id}
              checked={selected.includes(o.id)}
              onChange={(e) =>
                setSelected((s) => (e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id)))
              }
              className="size-4 accent-primary"
            />
            <span className="flex-1">
              {o.number}/{count} · {o.monthLabel}
            </span>
            <span className="tabular-nums">{formatBRL(o.amountCents)}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-sm">
        Valor bruto: <span className="font-medium tabular-nums">{formatBRL(gross)}</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor pago" htmlFor="ant-paid" hint="O que o banco cobrou, já com desconto">
          <MoneyInput
            id="ant-paid"
            name="paid"
            required
            key={gross}
            defaultValue={gross > 0 ? formatDecimalBR(gross) : ''}
          />
        </Field>
        <Field label="Data" htmlFor="ant-date">
          <Input id="ant-date" name="date" type="date" required max={today} defaultValue={today} />
        </Field>
      </div>
      <div
        role="radiogroup"
        aria-label="Como foi pago"
        className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm"
      >
        {(
          [
            ['ON_INVOICE', 'Na fatura'],
            ['DIRECT_PAYMENT', 'Pago avulso (Pix)'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={settlement === v}
            onClick={() => setSettlement(v)}
            className={cn(
              'h-9 rounded-md font-medium',
              settlement === v ? 'bg-background shadow-sm' : 'text-muted-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <input type="hidden" name="settlement" value={settlement} />
      {settlement === 'ON_INVOICE' ? (
        <Field label="Fatura onde entra o valor" htmlFor="ant-invoice">
          <NativeSelect
            id="ant-invoice"
            name="targetInvoiceId"
            defaultValue={openInvoices[0]?.id ?? ''}
            required
          >
            {openInvoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : (
        <p className="text-xs text-muted-foreground">
          O valor pago sai da conta principal na data informada.
        </p>
      )}
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" className="w-full sm:w-auto" disabled={pending || selected.length === 0}>
        {pending ? 'Registrando…' : 'Antecipar'}
      </Button>
    </form>
  );
}

/** Estorno: Modo A (crédito, parcelas continuam) ou Modo B (cancelamento total, D26). */
export function RefundForm({
  planId,
  invoices,
  today,
}: {
  planId: string;
  invoices: InvoiceOption[];
  today: string;
}) {
  const [state, action, pending] = useActionState(refundAction, null);
  const [mode, setMode] = useState<'CREDIT_KEEP_INSTALLMENTS' | 'CANCEL_PURCHASE'>(
    'CREDIT_KEEP_INSTALLMENTS',
  );
  useActionDone(state, mode === 'CANCEL_PURCHASE' ? 'Compra cancelada.' : 'Estorno registrado.');
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="mode" value={mode} />
      <div role="radiogroup" aria-label="Tipo de estorno" className="grid gap-2 text-sm">
        {(
          [
            [
              'CREDIT_KEEP_INSTALLMENTS',
              'Crédito, parcelas continuam',
              'Estorno parcial: o banco deu um crédito, mas as parcelas seguem.',
            ],
            [
              'CANCEL_PURCHASE',
              'Cancelar a compra toda',
              'Parcelas que ainda não vieram são canceladas; o que já foi cobrado volta como um crédito único.',
            ],
          ] as const
        ).map(([v, title, hint]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={mode === v}
            onClick={() => setMode(v)}
            className={cn(
              'rounded-lg border p-3 text-left',
              mode === v ? 'border-primary bg-primary/5' : 'text-muted-foreground',
            )}
          >
            <span className="block font-medium text-foreground">{title}</span>
            <span className="text-xs">{hint}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {mode === 'CREDIT_KEEP_INSTALLMENTS' && (
          <Field label="Valor do crédito" htmlFor="ref-amount">
            <MoneyInput id="ref-amount" name="amount" required />
          </Field>
        )}
        <Field label="Data do estorno" htmlFor="ref-date">
          <Input id="ref-date" name="refundDate" type="date" required defaultValue={today} />
        </Field>
      </div>
      <Field
        label="Fatura onde o crédito caiu"
        htmlFor="ref-invoice"
        hint={mode === 'CANCEL_PURCHASE' ? 'Só é usada se houver algo já cobrado para devolver.' : undefined}
      >
        <NativeSelect
          id="ref-invoice"
          name="targetInvoiceId"
          defaultValue={invoices.find((i) => i.open)?.id ?? invoices[0]?.id}
        >
          {invoices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Motivo" htmlFor="ref-reason" hint="Opcional">
        <Textarea id="ref-reason" name="reason" rows={2} maxLength={500} />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button
        type="submit"
        variant={mode === 'CANCEL_PURCHASE' ? 'destructive' : 'default'}
        disabled={pending}
        className="w-full sm:w-auto"
      >
        {pending ? 'Registrando…' : mode === 'CANCEL_PURCHASE' ? 'Cancelar compra' : 'Registrar crédito'}
      </Button>
    </form>
  );
}

export function PurchaseEditForm({
  planId,
  categories,
  users,
  defaults,
  amountEditable,
}: {
  planId: string;
  categories: CategoryOption[];
  users: UserOption[];
  defaults: {
    description: string;
    categoryId: string;
    beneficiaryUserId: string | null;
    notes: string | null;
    amountCents: number;
  };
  /** false quando já há parcela em fatura fechada, antecipação ou estorno */
  amountEditable: boolean;
}) {
  const [state, action, pending] = useActionState(editPurchaseAction, null);
  const [categoryId, setCategoryId] = useState(defaults.categoryId);
  useActionDone(state, 'Compra salva.');
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={planId} />
      <Field label="Descrição" htmlFor="pe-desc">
        <Input id="pe-desc" name="description" required maxLength={180} defaultValue={defaults.description} />
      </Field>
      {amountEditable ? (
        <Field
          label="Valor total"
          htmlFor="pe-amount"
          hint="As parcelas são refeitas; o resto do arredondamento vai na 1ª."
        >
          <MoneyInput
            id="pe-amount"
            name="amount"
            required
            defaultValue={formatDecimalBR(defaults.amountCents)}
          />
        </Field>
      ) : (
        <p className="text-sm text-muted-foreground">
          O valor só pode mudar enquanto nenhuma parcela estiver em fatura fechada e não houver antecipação ou
          estorno.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoria" htmlFor="pe-cat">
          <CategoryPicker
            id="pe-cat"
            name="categoryId"
            options={categories.filter((c) => c.kind === 'EXPENSE')}
            value={categoryId}
            onChange={setCategoryId}
          />
        </Field>
        <Field label="De quem é" htmlFor="pe-ben">
          <NativeSelect id="pe-ben" name="beneficiaryUserId" defaultValue={defaults.beneficiaryUserId ?? ''}>
            <option value="">Casal</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label="Observações" htmlFor="pe-notes">
        <Textarea id="pe-notes" name="notes" rows={2} maxLength={2000} defaultValue={defaults.notes ?? ''} />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" variant="outline" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Salvando…' : 'Salvar'}
      </Button>
    </form>
  );
}
