'use client';

import { type FormEvent, startTransition, useActionState, useState } from 'react';
import { confirmPaymentAction } from '@/app/(app)/lancamentos/actions';
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

/** Carteira do cartão de benefícios que pode pagar a conta; `label` já traz o saldo. */
export type PayWithWallet = { id: string; label: string };

/**
 * "Confirmar pagamento" (baixa): data e valor reais, pré-preenchidos com hoje e o estimado. Despesa pode ser paga
 * com uma carteira do cartão de benefícios (D69); sem saldo na conta, pede o aporte (de onde veio o que faltou).
 */
export function ConfirmPaymentDialog({
  id,
  version,
  description,
  income,
  amountText,
  today,
  trigger,
  wallets = [],
}: {
  id: string;
  version: number;
  description: string;
  income: boolean;
  amountText: string;
  today: string;
  trigger?: React.ReactNode;
  wallets?: PayWithWallet[];
}) {
  const [open, setOpen] = useState(false);
  // controlados: o formulário não pode zerar o que foi digitado quando o servidor pede o aporte
  const [amount, setAmount] = useState(amountText);
  const [date, setDate] = useState(today);
  const [walletId, setWalletId] = useState('');
  const [state, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof confirmPaymentAction>> | null, fd: FormData) => {
      const r = await confirmPaymentAction(prev, fd);
      if (r.ok) setOpen(false);
      return r;
    },
    null,
  );
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };
  const short = !income && !walletId && state && !state.ok ? state.details?.fundingShortCents : undefined;

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
        <form onSubmit={submit} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="version" value={version} />
          <Field label={income ? 'Valor recebido' : 'Valor pago'} htmlFor={`amount-${id}`}>
            <MoneyInput
              id={`amount-${id}`}
              name="amount"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Data" htmlFor={`date-${id}`}>
            <Input
              id={`date-${id}`}
              name="date"
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>
          {!income && wallets.length > 0 && (
            <Field
              label="Pagar com"
              htmlFor={`wallet-${id}`}
              hint={
                walletId
                  ? 'O valor sai da carteira do cartão de benefícios, não da conta.'
                  : 'Conta bancária, ou uma carteira do cartão de benefícios.'
              }
            >
              <NativeSelect
                id={`wallet-${id}`}
                name="walletId"
                value={walletId}
                onChange={(e) => setWalletId(e.target.value)}
              >
                <option value="">Conta bancária</option>
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {short !== undefined && <FundingFields shortCents={short} idPrefix={`pay-${id}`} />}
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
