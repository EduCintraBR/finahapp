'use client';

import { type FormEvent, startTransition, useActionState, useState } from 'react';
import { benefitSpendAction } from '@/app/(app)/beneficios/actions';
import { cardPurchaseAction } from '@/app/(app)/cartoes/actions';
import { saveEntryAction } from '@/app/(app)/lancamentos/actions';
import { Field, FormError, MoneyInput, NativeSelect } from '@/components/forms/fields';
import { FundingFields } from '@/components/forms/funding-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { CategoryOption, UserOption } from '@/db/queries/lookups';
import { formatDateBR } from '@/domain/dates';
import { formatBRL, splitInstallments, tryParseBRL } from '@/domain/money';
import { ACCOUNT_PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';

export type EntryFormDefaults = {
  id: string;
  version: number;
  kind: 'INCOME' | 'EXPENSE';
  amountText: string;
  description: string;
  categoryId: string;
  paymentMethod: string;
  date: string;
  beneficiaryUserId: string | null;
  notes: string | null;
  pending: boolean;
};

type Mode = 'EXPENSE' | 'INCOME' | 'CARD' | 'BENEFIT';
export type CardOption = { id: string; name: string };
/** carteira de um cartão de benefícios; `label` já traz o saldo ("Multibenefícios · saldo R$ 800,00") */
export type WalletOption = { id: string; label: string };

/** Prévia das parcelas com a mesma regra do servidor (resto na 1ª). Só exibição. */
function installmentPreview(amountText: string, count: number): string | null {
  const r = tryParseBRL(amountText);
  if (!r.ok || r.value <= 0 || !Number.isInteger(count) || count < 2 || count > 72 || r.value < count)
    return null;
  const [first, ...rest] = splitInstallments(r.value, count);
  return first === rest[0]
    ? `${count}× de ${formatBRL(first!)}`
    : `1ª de ${formatBRL(first!)} + ${count - 1}× de ${formatBRL(rest[0]!)}`;
}

export function EntryForm({
  categories,
  users,
  today,
  defaults,
  returnTo,
  cards = [],
  wallets = [],
  initialMode,
  initialCardId,
  initialWalletId,
}: {
  categories: CategoryOption[];
  users: UserOption[];
  today: string;
  defaults?: EntryFormDefaults;
  returnTo: string;
  cards?: CardOption[];
  wallets?: WalletOption[];
  initialMode?: Mode;
  /** cartão já escolhido (quando se vem da tela de um cartão); sem isso, o primeiro da lista */
  initialCardId?: string;
  /** carteira já escolhida (vindo da tela do cartão de benefícios) */
  initialWalletId?: string;
}) {
  const [entryState, entryAction, entryPending] = useActionState(saveEntryAction, null);
  const [cardState, cardAction, cardPending] = useActionState(cardPurchaseAction, null);
  const [benefitState, benefitAction, benefitPending] = useActionState(benefitSpendAction, null);
  const [mode, setMode] = useState<Mode>(
    defaults?.kind ??
      (initialMode === 'CARD' && cards.length
        ? 'CARD'
        : initialMode === 'BENEFIT' && wallets.length
          ? 'BENEFIT'
          : 'EXPENSE'),
  );
  const [categoryId, setCategoryId] = useState(defaults?.categoryId ?? '');
  const [amountText, setAmountText] = useState(defaults?.amountText ?? '');
  const [installments, setInstallments] = useState('1');
  const [date, setDate] = useState(defaults?.date ?? today);
  // despesa nova nasce "a pagar" (D69); com a chave ligada, já saiu da conta
  const [paid, setPaid] = useState(false);
  const categoryKind = mode === 'INCOME' ? 'INCOME' : 'EXPENSE';
  const options = categories.filter((c) => c.kind === categoryKind);
  const isCard = mode === 'CARD';
  const isBenefit = mode === 'BENEFIT';
  const state = isCard ? cardState : isBenefit ? benefitState : entryState;
  const pending = isCard ? cardPending : isBenefit ? benefitPending : entryPending;
  const modes: Mode[] = defaults
    ? [defaults.kind]
    : [
        'EXPENSE',
        'INCOME',
        ...(cards.length ? (['CARD'] as const) : []),
        ...(wallets.length ? (['BENEFIT'] as const) : []),
      ];

  const pick = (m: Mode) => {
    setMode(m);
    const kind = m === 'INCOME' ? 'INCOME' : 'EXPENSE';
    if (!categories.some((c) => c.id === categoryId && c.kind === kind)) setCategoryId('');
  };
  const preview = isCard ? installmentPreview(amountText, Number(installments)) : null;
  const expenseMode = mode === 'EXPENSE' && !defaults;
  // enviado por onSubmit (e não por <form action>) para o React não limpar o formulário quando o servidor
  // devolve "faltam R$ X, informe o aporte"
  const act = isCard ? cardAction : isBenefit ? benefitAction : entryAction;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => act(fd));
  };
  const fundingShort =
    !isCard && !isBenefit && (mode === 'INCOME' ? false : paid) && state && !state.ok
      ? state.details?.fundingShortCents
      : undefined;

  return (
    <form onSubmit={submit} className="space-y-4">
      {defaults && (
        <>
          <input type="hidden" name="id" value={defaults.id} />
          <input type="hidden" name="version" value={defaults.version} />
        </>
      )}
      <input type="hidden" name="returnTo" value={returnTo} />
      {!isCard && !isBenefit && <input type="hidden" name="kind" value={mode} />}

      {modes.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Tipo"
          className={cn(
            'grid gap-1 rounded-lg bg-muted p-1',
            modes.length === 4 ? 'grid-cols-4' : modes.length === 3 ? 'grid-cols-3' : 'grid-cols-2',
          )}
        >
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => pick(m)}
              className={cn(
                'h-9 rounded-md text-sm font-medium transition-colors',
                mode === m ? 'bg-background shadow-sm' : 'text-muted-foreground',
                mode === m &&
                  (m === 'INCOME' ? 'text-income' : m === 'EXPENSE' ? 'text-expense' : 'text-primary'),
              )}
            >
              {m === 'EXPENSE'
                ? 'Despesa'
                : m === 'INCOME'
                  ? 'Receita'
                  : m === 'CARD'
                    ? 'Cartão'
                    : 'Benefício'}
            </button>
          ))}
        </div>
      )}

      <Field label={isCard ? 'Valor total da compra' : 'Valor'} htmlFor="amount">
        <MoneyInput
          id="amount"
          name="amount"
          required
          autoFocus={!defaults}
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          className="h-12 text-xl"
        />
      </Field>

      {isCard && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cartão" htmlFor="cardId">
            <NativeSelect id="cardId" name="cardId" required defaultValue={initialCardId ?? cards[0]?.id}>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Parcelas" htmlFor="installments" hint={preview ?? 'À vista = 1'}>
            <Input
              id="installments"
              name="installments"
              type="number"
              inputMode="numeric"
              min={1}
              max={72}
              required
              value={installments}
              onChange={(e) => setInstallments(e.target.value)}
            />
          </Field>
        </div>
      )}

      {isBenefit && (
        <Field label="Carteira" htmlFor="walletId" hint="Cartão pré-pago: o gasto sai do saldo da carteira.">
          <NativeSelect
            id="walletId"
            name="walletId"
            required
            defaultValue={initialWalletId ?? wallets[0]?.id}
          >
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      <Field label="Descrição" htmlFor="description">
        <Input
          id="description"
          name="description"
          required
          maxLength={180}
          defaultValue={defaults?.description}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoria" htmlFor="categoryId">
          <NativeSelect
            id="categoryId"
            name="categoryId"
            required
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="" disabled>
              Escolha…
            </option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {!isCard && !isBenefit && (
          <Field label="Meio" htmlFor="paymentMethod">
            <NativeSelect
              id="paymentMethod"
              name="paymentMethod"
              defaultValue={defaults?.paymentMethod ?? 'PIX'}
            >
              {ACCOUNT_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {(isCard || isBenefit) && (
          <BeneficiaryField users={users} defaultValue={defaults?.beneficiaryUserId ?? ''} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label={
            defaults?.pending || (expenseMode && !paid)
              ? 'Vencimento'
              : isCard
                ? 'Data da compra'
                : isBenefit
                  ? 'Data do gasto'
                  : 'Data'
          }
          htmlFor="date"
          hint={
            !isCard && !defaults?.pending && (mode === 'INCOME' || paid) && date > today
              ? `Data futura: fica agendado e só entra no saldo em ${formatDateBR(date)}.`
              : undefined
          }
        >
          <Input
            id="date"
            name="date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        {!isCard && !isBenefit && (
          <BeneficiaryField users={users} defaultValue={defaults?.beneficiaryUserId ?? ''} />
        )}
      </div>

      {expenseMode && (
        <div>
          <input type="hidden" name="paid" value="false" />
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
            <input
              type="checkbox"
              name="paid"
              value="true"
              checked={paid}
              onChange={(e) => setPaid(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              <span className="font-medium">Já paguei</span>
              <span className="block text-xs text-muted-foreground">
                {paid
                  ? 'Sai do saldo da conta agora, na data escolhida.'
                  : 'Fica a pagar no dia do vencimento (vencida se a data já passou) até você dar baixa em “Paguei”.'}
              </span>
            </span>
          </label>
        </div>
      )}

      <Field label="Observações" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} maxLength={2000} defaultValue={defaults?.notes ?? ''} />
      </Field>

      {fundingShort !== undefined && <FundingFields shortCents={fundingShort} idPrefix="entry" />}

      <FormError message={state && !state.ok ? state.error : null} />

      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending ? 'Salvando…' : defaults ? 'Salvar alterações' : 'Lançar'}
      </Button>
    </form>
  );
}

function BeneficiaryField({ users, defaultValue }: { users: UserOption[]; defaultValue: string }) {
  return (
    <Field label="De quem é" htmlFor="beneficiaryUserId">
      <NativeSelect id="beneficiaryUserId" name="beneficiaryUserId" defaultValue={defaultValue}>
        <option value="">Casal</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}
