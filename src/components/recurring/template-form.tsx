'use client';

import { useActionState, useState } from 'react';
import { changeFromAction, createTemplateAction } from '@/app/(app)/fixos/actions';
import { CategoryPicker } from '@/components/categories/category-picker';
import { Field, FormError, MoneyInput, NativeSelect } from '@/components/forms/fields';
import { StickyActions } from '@/components/forms/sticky-actions';
import { MonthField } from '@/components/forms/month-field';
import { Button } from '@/components/ui/button';
import { useActionDone } from '@/components/ui/sheet-action';
import { Input } from '@/components/ui/input';
import type { CategoryOption, UserOption } from '@/db/queries/lookups';
import { ACCOUNT_PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';

export type TemplateDefaults = {
  id: string;
  direction: 'INCOME' | 'EXPENSE';
  type: 'FIXED' | 'RECURRING_VARIABLE';
  description: string;
  categoryId: string;
  amountText: string;
  dayOfMonth: number;
  paymentMethod: string;
  creditCardId: string | null;
  beneficiaryUserId: string | null;
};

/**
 * Criar fixo/recorrente, ou "alterar a partir de" (com `defaults`): os valores novos valem do mês
 * escolhido em diante; meses anteriores e contas já pagas não mudam.
 */
export function TemplateForm({
  categories,
  users,
  currentMonth,
  defaults,
  cards = [],
}: {
  categories: CategoryOption[];
  users: UserOption[];
  /** 'AAAA-MM' */
  currentMonth: string;
  defaults?: TemplateDefaults;
  /** cartões ativos: habilitam assinatura no cartão (D33) */
  cards?: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(defaults ? changeFromAction : createTemplateAction, null);
  useActionDone(state, defaults ? 'Fixo alterado.' : undefined);
  const [direction, setDirection] = useState<'INCOME' | 'EXPENSE'>(defaults?.direction ?? 'EXPENSE');
  const [categoryId, setCategoryId] = useState(defaults?.categoryId ?? '');
  const options = categories.filter((c) => c.kind === direction);
  const [method, setMethod] = useState(defaults?.paymentMethod ?? 'BOLETO');
  // trocar entre conta e cartão num "alterar a partir de" não é permitido (encerre e crie outro)
  const methods = [
    ...(defaults?.paymentMethod === 'CREDIT_CARD' ? [] : ACCOUNT_PAYMENT_METHODS),
    ...(direction === 'EXPENSE' && cards.length && (!defaults || defaults.paymentMethod === 'CREDIT_CARD')
      ? (['CREDIT_CARD'] as const)
      : []),
  ];

  return (
    <form action={action} className="space-y-4">
      {defaults && <input type="hidden" name="id" value={defaults.id} />}
      {!defaults && (
        <>
          <input type="hidden" name="direction" value={direction} />
          <div
            role="radiogroup"
            aria-label="Direção"
            className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
          >
            {(['EXPENSE', 'INCOME'] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={direction === d}
                onClick={() => {
                  setDirection(d);
                  if (d === 'INCOME' && method === 'CREDIT_CARD') setMethod('BOLETO');
                  if (!categories.some((c) => c.id === categoryId && c.kind === d)) setCategoryId('');
                }}
                className={cn(
                  'h-9 rounded-md text-sm font-medium',
                  direction === d ? 'bg-background shadow-sm' : 'text-muted-foreground',
                )}
              >
                {d === 'EXPENSE' ? 'Conta a pagar' : 'Receita prevista'}
              </button>
            ))}
          </div>
        </>
      )}

      <Field label="Descrição" htmlFor="t-description">
        <Input
          id="t-description"
          name="description"
          required
          maxLength={140}
          placeholder={direction === 'EXPENSE' ? 'Ex.: Aluguel, Luz, Internet' : 'Ex.: Salário CLT, Renda PJ'}
          defaultValue={defaults?.description}
        />
      </Field>

      <Field
        label="Tipo"
        htmlFor="t-type"
        hint="Fixo: o valor é sempre o mesmo. Recorrente: o valor muda todo mês (você confirma o valor real ao pagar)."
      >
        <NativeSelect id="t-type" name="type" defaultValue={defaults?.type ?? 'FIXED'}>
          <option value="FIXED">Fixo (valor exato)</option>
          <option value="RECURRING_VARIABLE">Recorrente (valor estimado)</option>
        </NativeSelect>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor" htmlFor="t-amount">
          <MoneyInput id="t-amount" name="amount" required defaultValue={defaults?.amountText} />
        </Field>
        <Field label="Dia do vencimento" htmlFor="t-day" hint="31 = último dia do mês">
          <Input
            id="t-day"
            name="dayOfMonth"
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            required
            defaultValue={defaults?.dayOfMonth ?? 10}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoria" htmlFor="t-category">
          <CategoryPicker
            id="t-category"
            name="categoryId"
            options={options}
            value={categoryId}
            onChange={setCategoryId}
          />
        </Field>
        <Field label="Meio" htmlFor="t-method">
          <NativeSelect
            id="t-method"
            name="paymentMethod"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {methods.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {method === 'CREDIT_CARD' && (
        <Field
          label="Cartão"
          htmlFor="t-card"
          hint="Vira uma compra à vista nesse cartão no dia da cobrança."
        >
          <NativeSelect
            id="t-card"
            name="creditCardId"
            required
            defaultValue={defaults?.creditCardId ?? cards[0]?.id}
          >
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}

      <Field label="De quem é" htmlFor="t-beneficiary">
        <NativeSelect
          id="t-beneficiary"
          name="beneficiaryUserId"
          defaultValue={defaults?.beneficiaryUserId ?? ''}
        >
          <option value="">Casal</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </NativeSelect>
      </Field>

      {defaults ? (
        <Field
          label="Vale a partir de"
          htmlFor="t-effective"
          hint="Meses anteriores e contas já pagas não mudam. Pendentes a partir deste mês recebem o valor novo."
        >
          <MonthField
            id="t-effective"
            name="effectiveMonth"
            required
            around={currentMonth}
            defaultValue={currentMonth}
          />
        </Field>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Primeiro mês" htmlFor="t-start">
            <MonthField
              id="t-start"
              name="startMonth"
              required
              around={currentMonth}
              defaultValue={currentMonth}
            />
          </Field>
          <Field label="Último mês" htmlFor="t-end" hint="Opcional">
            <MonthField id="t-end" name="endMonth" around={currentMonth} />
          </Field>
        </div>
      )}

      <FormError message={state && !state.ok ? state.error : null} />
      {defaults ? (
        <Button type="submit" className="h-11 w-full" disabled={pending}>
          {pending ? 'Salvando…' : 'Aplicar mudança'}
        </Button>
      ) : (
        <StickyActions>
          <Button type="submit" className="h-11" disabled={pending}>
            {pending ? 'Salvando…' : 'Cadastrar'}
          </Button>
        </StickyActions>
      )}
    </form>
  );
}
