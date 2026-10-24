'use client';

import { type FormEvent, startTransition, useActionState, useState } from 'react';
import { createLoanAction, payLoanAction } from '@/app/(app)/emprestimos/actions';
import { Field, FormError, MoneyInput } from '@/components/forms/fields';
import { FundingFields } from '@/components/forms/funding-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { buildLoanInstallments, MAX_LOAN_INSTALLMENTS } from '@/domain/loans/loans';
import { formatBRL, formatDecimalBR, tryParseBRL } from '@/domain/money';
import { formatDateBR } from '@/domain/dates';

/** Prévia do parcelamento com a mesma regra do servidor (resto na 1ª). Só exibição. */
function loanPreview(totalText: string, principalText: string, count: number): string | null {
  const total = tryParseBRL(totalText);
  const principal = tryParseBRL(principalText);
  if (
    !total.ok ||
    total.value <= 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > MAX_LOAN_INSTALLMENTS
  ) {
    return null;
  }
  if (total.value < count) return null;
  const [first, ...rest] = buildLoanInstallments(total.value, count, '2026-01-01').map((p) => p.amountCents);
  const parcels =
    rest.length === 0 || first === rest[0]
      ? `${count}× de ${formatBRL(first!)}`
      : `1ª de ${formatBRL(first!)} + ${count - 1}× de ${formatBRL(rest[0]!)}`;
  if (!principal.ok || principal.value <= 0 || total.value < principal.value) return parcels;
  const interest = total.value - principal.value;
  const pct = ((interest * 10000) / principal.value / 100).toFixed(2).replace('.', ',');
  return `${parcels} · juros embutidos ${formatBRL(interest)} (${pct}% sobre o recebido)`;
}

export function LoanForm({ today, defaultFirstDue }: { today: string; defaultFirstDue: string }) {
  const [state, action, pending] = useActionState(createLoanAction, null);
  const [principal, setPrincipal] = useState('');
  const [total, setTotal] = useState('');
  const [count, setCount] = useState('12');
  const preview = loanPreview(total, principal, Number(count));

  return (
    <form action={action} className="space-y-4">
      <Field label="Nome" htmlFor="l-name" hint="Ex.: Empréstimo pessoal, Consignado">
        <Input id="l-name" name="name" required maxLength={80} />
      </Field>
      <Field label="Quem emprestou (opcional)" htmlFor="l-lender">
        <Input id="l-lender" name="lender" maxLength={80} placeholder="Banco, financeira…" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor recebido" htmlFor="l-principal" hint="O que caiu na conta.">
          <MoneyInput
            id="l-principal"
            name="principal"
            required
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
          />
        </Field>
        <Field label="Total a pagar" htmlFor="l-total" hint="Já com os juros.">
          <MoneyInput
            id="l-total"
            name="total"
            required
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Parcelas" htmlFor="l-count" hint={preview ?? 'O app divide o total em parcelas mensais.'}>
        <Input
          id="l-count"
          name="installments"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_LOAN_INSTALLMENTS}
          required
          value={count}
          onChange={(e) => setCount(e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Recebi em" htmlFor="l-received">
          <Input id="l-received" name="receivedDate" type="date" required defaultValue={today} max={today} />
        </Field>
        <Field label="Vence a 1ª parcela" htmlFor="l-first">
          <Input id="l-first" name="firstDueDate" type="date" required defaultValue={defaultFirstDue} />
        </Field>
      </div>
      <Field label="Observações" htmlFor="l-notes">
        <Textarea id="l-notes" name="notes" rows={2} maxLength={2000} />
      </Field>
      <p className="text-xs text-muted-foreground">
        O valor recebido entra no saldo da conta (sem contar como receita). Cada parcela vira uma conta a
        pagar no dia do vencimento, e você dá baixa quando pagar. Para adiantar, use “Pagar parcelas” no
        empréstimo.
      </p>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending ? 'Salvando…' : 'Cadastrar empréstimo'}
      </Button>
    </form>
  );
}

export type PendingInstallment = { id: string; number: number; dueDate: string; scheduledCents: number };

/**
 * Pagar uma ou mais parcelas de uma vez (em dia, adiantadas ou atrasadas). Pergunta quanto você pagou e quando;
 * o desconto é a soma das parcelas escolhidas menos o que você pagou (ou o acréscimo, se pagou mais).
 */
export function PayLoanForm({
  loanId,
  pending: pendingInstallments,
  today,
  total,
}: {
  loanId: string;
  pending: PendingInstallment[];
  today: string;
  total: number;
}) {
  const [state, action, pending] = useActionState(payLoanAction, null);
  const [selected, setSelected] = useState<string[]>(() =>
    pendingInstallments[0] ? [pendingInstallments[0].id] : [],
  );
  const [paidText, setPaidText] = useState<string | null>(null); // null = ainda segue a soma das parcelas

  const scheduledSum = pendingInstallments
    .filter((p) => selected.includes(p.id))
    .reduce((s, p) => s + p.scheduledCents, 0);
  const paidValue = paidText ?? (scheduledSum > 0 ? formatDecimalBR(scheduledSum) : '');
  const paid = tryParseBRL(paidValue);
  const diff = paid.ok ? scheduledSum - paid.value : null;

  // onSubmit (e não <form action>): o React não limpa o formulário quando o servidor pede o aporte
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
  const fundingShort = state && !state.ok ? state.details?.fundingShortCents : undefined;

  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    setPaidText(null); // trocou as parcelas: volta a sugerir a soma
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <input type="hidden" name="loanId" value={loanId} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Parcelas</span>
        <span className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelected(pendingInstallments.map((p) => p.id));
              setPaidText(null);
            }}
          >
            Todas ({pendingInstallments.length})
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelected([]);
              setPaidText(null);
            }}
          >
            Limpar
          </Button>
        </span>
      </div>
      <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border" aria-label="Parcelas pendentes">
        {pendingInstallments.map((p) => (
          <li key={p.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
              <input
                type="checkbox"
                name="installmentId"
                value={p.id}
                checked={selected.includes(p.id)}
                onChange={() => toggle(p.id)}
                className="size-4 accent-primary"
              />
              <span className="min-w-0 flex-1">
                {p.number}/{total} · vence {formatDateBR(p.dueDate)}
              </span>
              <span className="whitespace-nowrap tabular-nums">{formatBRL(p.scheduledCents)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor que paguei" htmlFor="lp-paid">
          <MoneyInput
            id="lp-paid"
            name="paid"
            required
            value={paidValue}
            onChange={(e) => setPaidText(e.target.value)}
          />
        </Field>
        <Field label="Data do pagamento" htmlFor="lp-date">
          <Input id="lp-date" name="date" type="date" required defaultValue={today} max={today} />
        </Field>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="pay-preview">
        {selected.length === 0
          ? 'Escolha as parcelas que você pagou.'
          : diff === null
            ? `Parcelas escolhidas: ${formatBRL(scheduledSum)}`
            : diff > 0
              ? `Programado ${formatBRL(scheduledSum)} · desconto de ${formatBRL(diff)}`
              : diff < 0
                ? `Programado ${formatBRL(scheduledSum)} · acréscimo de ${formatBRL(-diff)}`
                : `Programado ${formatBRL(scheduledSum)} · sem desconto`}
      </p>
      {fundingShort !== undefined && <FundingFields shortCents={fundingShort} idPrefix="loan" />}
      <FormError message={state && !state.ok ? state.error : null} />
      {state?.ok && (
        <p role="status" className="text-sm text-income">
          Pagamento registrado: {formatBRL(state.data.paidCents)}
          {state.data.savingsCents > 0 && ` · economia de ${formatBRL(state.data.savingsCents)}`}
          {state.data.lateFeesCents > 0 && ` · acréscimo de ${formatBRL(state.data.lateFeesCents)}`}.
        </p>
      )}
      <Button type="submit" disabled={pending || selected.length === 0} className="w-full sm:w-auto">
        {pending ? 'Registrando…' : 'Registrar pagamento'}
      </Button>
    </form>
  );
}
