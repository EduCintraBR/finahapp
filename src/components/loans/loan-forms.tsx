'use client';

import { type FormEvent, startTransition, useActionState, useState } from 'react';
import { Check } from 'lucide-react';
import { createLoanAction, payLoanAction } from '@/app/(app)/emprestimos/actions';
import { Field, FormError, MoneyInput } from '@/components/forms/fields';
import { FundingFields } from '@/components/forms/funding-fields';
import { StickyActions } from '@/components/forms/sticky-actions';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toaster';
import type { LoanInstallmentView } from '@/db/queries/loans';
import { buildLoanInstallments, MAX_LOAN_INSTALLMENTS } from '@/domain/loans/loans';
import { formatBRL, formatDecimalBR, tryParseBRL } from '@/domain/money';
import { formatDateBR } from '@/domain/dates';
import { cn } from '@/lib/utils';

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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Parcelas do empréstimo numa lista só: as pagas com o que foi pago (adiantou/atrasou, desconto/acréscimo) e as
 * pendentes com seleção. "Pagar N parcelas" fica sempre à vista e abre o painel que pergunta quanto você pagou e
 * quando; o desconto é a soma das escolhidas menos o que você pagou (ou o acréscimo, se pagou mais).
 */
export function LoanInstallments({
  loanId,
  installments,
  total,
  today,
}: {
  loanId: string;
  installments: LoanInstallmentView[];
  total: number;
  today: string;
}) {
  const pendingList = installments.filter((i) => i.paidCents === null);
  const [chosen, setChosen] = useState<string[]>(() => (pendingList[0] ? [pendingList[0].id] : []));
  const [paidText, setPaidText] = useState<string | null>(null); // null = ainda segue a soma das parcelas
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof payLoanAction>> | null, fd: FormData) => {
      const r = await payLoanAction(prev, fd);
      if (r.ok) {
        // pagou: fecha o painel, limpa a escolha e avisa no rodapé
        setOpen(false);
        setChosen([]);
        setPaidText(null);
        toast(
          `Pagamento registrado: ${formatBRL(r.data.paidCents)}${
            r.data.savingsCents > 0 ? ` · economia de ${formatBRL(r.data.savingsCents)}` : ''
          }${r.data.lateFeesCents > 0 ? ` · acréscimo de ${formatBRL(r.data.lateFeesCents)}` : ''}.`,
        );
      }
      return r;
    },
    null,
  );

  // depois de pagar, a lista muda: só vale o que continua pendente
  const selected = chosen.filter((id) => pendingList.some((p) => p.id === id));
  const scheduledSum = pendingList
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

  const choose = (ids: string[]) => {
    setChosen(ids);
    setPaidText(null); // trocou as parcelas: volta a sugerir a soma
  };
  const toggle = (id: string) =>
    choose(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <>
      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Parcelas</CardTitle>
            {pendingList.length > 0 && (
              <span className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => choose(pendingList.map((p) => p.id))}
                >
                  Todas ({pendingList.length})
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => choose([])}>
                  Limpar
                </Button>
              </span>
            )}
          </div>
          <CardDescription>
            {pendingList.length > 0
              ? 'Marque as que você pagou. Cada parcela também aparece em Lançamentos e na Início quando chega o mês.'
              : 'Cada parcela também aparece em Lançamentos e na Início quando chega o mês.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="border-t px-0">
          <ul className="divide-y" aria-label="Parcelas">
            {installments.map((i) => {
              const isPaid = i.paidCents !== null;
              const diffPaid = isPaid ? i.scheduledCents - i.paidCents! : 0;
              const body = (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {i.number}/{total}
                      {isPaid ? (
                        <span className="ml-2 text-xs font-normal text-income">paga</span>
                      ) : (
                        <> · vence {formatDateBR(i.dueDate)}</>
                      )}
                      {i.overdue && <span className="ml-2 text-xs text-destructive">atrasada</span>}
                    </div>
                    {isPaid && (
                      <div className="text-xs text-muted-foreground">
                        Pago em {formatDateBR(i.paidDate!)} · venc. {formatDateBR(i.dueDate)}
                        {i.daysEarly !== null &&
                          i.daysEarly > 0 &&
                          ` · adiantou ${plural(i.daysEarly, 'dia', 'dias')}`}
                        {i.daysEarly !== null &&
                          i.daysEarly < 0 &&
                          ` · atrasou ${plural(-i.daysEarly, 'dia', 'dias')}`}
                      </div>
                    )}
                    {isPaid && diffPaid !== 0 && (
                      <div className={cn('text-xs', diffPaid > 0 ? 'text-income' : 'text-expense')}>
                        {diffPaid > 0
                          ? `desconto de ${formatBRL(diffPaid)}`
                          : `acréscimo de ${formatBRL(-diffPaid)}`}{' '}
                        (programado {formatBRL(i.scheduledCents)})
                      </div>
                    )}
                  </div>
                  <Amount
                    cents={isPaid ? i.paidCents! : i.scheduledCents}
                    className={cn('shrink-0 font-medium', !isPaid && 'text-muted-foreground')}
                  />
                </>
              );
              return (
                <li key={i.id} data-testid="loan-installment">
                  {isPaid ? (
                    <div className="flex items-center gap-3 px-4 py-3 text-sm">
                      <span aria-hidden className="grid size-4 shrink-0 place-items-center text-income">
                        <Check className="size-4" />
                      </span>
                      {body}
                    </div>
                  ) : (
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40">
                      <input
                        type="checkbox"
                        checked={selected.includes(i.id)}
                        onChange={() => toggle(i.id)}
                        className="size-4 shrink-0 accent-primary"
                      />
                      {body}
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {pendingList.length > 0 && (
        <StickyActions>
          <Button
            type="button"
            className="h-11"
            disabled={selected.length === 0}
            onClick={() => setOpen(true)}
          >
            {selected.length === 0
              ? 'Escolha as parcelas que pagou'
              : `Pagar ${plural(selected.length, 'parcela', 'parcelas')} · ${formatBRL(scheduledSum)}`}
          </Button>
        </StickyActions>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pagar parcelas</DialogTitle>
            <DialogDescription>
              {pendingList
                .filter((p) => selected.includes(p.id))
                .map((p) => `${p.number}/${total}`)
                .join(', ')}{' '}
              · programado {formatBRL(scheduledSum)}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <input type="hidden" name="loanId" value={loanId} />
            {selected.map((id) => (
              <input key={id} type="hidden" name="installmentId" value={id} />
            ))}
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
              {diff === null
                ? `Parcelas escolhidas: ${formatBRL(scheduledSum)}`
                : diff > 0
                  ? `Programado ${formatBRL(scheduledSum)} · desconto de ${formatBRL(diff)}`
                  : diff < 0
                    ? `Programado ${formatBRL(scheduledSum)} · acréscimo de ${formatBRL(-diff)}`
                    : `Programado ${formatBRL(scheduledSum)} · sem desconto`}
            </p>
            {fundingShort !== undefined && <FundingFields shortCents={fundingShort} idPrefix="loan" />}
            <FormError message={state && !state.ok ? state.error : null} />
            <Button type="submit" disabled={pending || selected.length === 0} className="h-11 w-full">
              {pending ? 'Registrando…' : 'Registrar pagamento'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
