'use client';

import { useActionState } from 'react';
import { setBudgetAction, stopBudgetAction } from '@/app/(app)/orcamentos/actions';
import { Field, FormError, MoneyInput, NativeSelect } from '@/components/forms/fields';
import { MonthField } from '@/components/forms/month-field';
import { Button } from '@/components/ui/button';
import { useActionDone } from '@/components/ui/sheet-action';

/**
 * Novo orçamento ou novo valor (D79). Sem `categoryId` fixo, escolhe o que acompanhar: o teto do mês (vazio) ou uma
 * categoria. O valor vale a partir do mês escolhido; os meses anteriores não mudam.
 */
export function BudgetForm({
  month,
  options,
  categoryId,
  defaultAmountText,
}: {
  /** mês da tela ("AAAA-MM"): o padrão do "a partir de" */
  month: string;
  /** o que dá para acompanhar (novo orçamento); `id` vazio = teto do mês */
  options?: { id: string; name: string }[];
  /** orçamento existente: a categoria dele ('' = teto) */
  categoryId?: string;
  defaultAmountText?: string;
}) {
  const [state, action, pending] = useActionState(setBudgetAction, null);
  useActionDone(state, 'Orçamento salvo.');
  return (
    <form action={action} className="space-y-4">
      {options ? (
        <Field
          label="O que acompanhar"
          htmlFor="budget-category"
          hint="A categoria soma as subcategorias dela. O teto soma todos os gastos do mês."
        >
          {/* sem `required`: o teto tem valor vazio e o navegador barraria o envio; sempre há uma opção escolhida */}
          <NativeSelect id="budget-category" name="categoryId" defaultValue={options[0]?.id}>
            {options.map((o) => (
              <option key={o.id || 'teto'} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : (
        <input type="hidden" name="categoryId" value={categoryId ?? ''} />
      )}
      <Field label="Limite por mês" htmlFor="budget-amount" hint="Conta o Gasto Mensal: o que sai no mês.">
        <MoneyInput id="budget-amount" name="amount" required defaultValue={defaultAmountText} />
      </Field>
      <Field
        label="Vale a partir de"
        htmlFor="budget-from"
        hint="Vale desse mês em diante. Os meses anteriores continuam com o valor que tinham."
      >
        <MonthField
          id="budget-from"
          name="fromMonth"
          required
          around={month}
          defaultValue={month}
          before={12}
          after={24}
        />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Salvando…' : 'Salvar'}
      </Button>
    </form>
  );
}

/** Parar de acompanhar a partir de um mês: os meses anteriores ficam com o orçamento que tinham. */
export function StopBudgetForm({ id, month }: { id: string; month: string }) {
  const [state, action, pending] = useActionState(stopBudgetAction, null);
  useActionDone(state, 'Orçamento encerrado.');
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Field
        label="A partir de"
        htmlFor="budget-stop"
        hint="Desse mês em diante não tem orçamento. Nada é apagado: dá para voltar a acompanhar quando quiser."
      >
        <MonthField
          id="budget-stop"
          name="fromMonth"
          required
          around={month}
          defaultValue={month}
          before={12}
          after={24}
        />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" variant="destructive" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Salvando…' : 'Parar de acompanhar'}
      </Button>
    </form>
  );
}
