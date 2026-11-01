'use client';

import { useActionState, useState } from 'react';
import { onboardingAction } from '@/app/(app)/cartoes/actions';
import { CategoryPicker } from '@/components/categories/category-picker';
import { Field, FormError, MoneyInput, NativeSelect } from '@/components/forms/fields';
import { StickyActions } from '@/components/forms/sticky-actions';
import { MonthField } from '@/components/forms/month-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CategoryOption, UserOption } from '@/db/queries/lookups';

/** Parcelamento que já estava rolando antes de usar o app (D9): só as parcelas restantes entram. */
export function OnboardingForm({
  cardId,
  categories,
  users,
  currentMonth,
  storeCreditDue,
}: {
  cardId: string;
  categories: CategoryOption[];
  users: UserOption[];
  /** 'AAAA-MM' da fatura aberta atual */
  currentMonth: string;
  /** crediário (D73): vencimento sugerido da fatura atual; pede a data em vez do mês */
  storeCreditDue?: string;
}) {
  const [state, action, pending] = useActionState(onboardingAction, null);
  const [categoryId, setCategoryId] = useState('');
  const [due, setDue] = useState(storeCreditDue ?? '');
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="cardId" value={cardId} />
      <Field label="Descrição" htmlFor="ob-desc">
        <Input id="ob-desc" name="description" required maxLength={180} placeholder="Ex.: Geladeira" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Valor total da compra" htmlFor="ob-total">
          <MoneyInput id="ob-total" name="total" required />
        </Field>
        <Field label="Data da compra" htmlFor="ob-date">
          <Input id="ob-date" name="purchaseDate" type="date" required />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Parcela atual" htmlFor="ob-current" hint="Ex.: 9 (de 10)">
          <Input
            id="ob-current"
            name="currentInstallment"
            type="number"
            inputMode="numeric"
            min={1}
            max={72}
            required
          />
        </Field>
        <Field label="Total de parcelas" htmlFor="ob-count">
          <Input
            id="ob-count"
            name="installments"
            type="number"
            inputMode="numeric"
            min={2}
            max={72}
            required
          />
        </Field>
      </div>
      {storeCreditDue !== undefined ? (
        <Field
          label="Vencimento da parcela atual"
          htmlFor="ob-due"
          hint="A data em que vence a fatura da parcela atual. As próximas vencem no mesmo dia dos meses seguintes."
        >
          <input type="hidden" name="currentInvoiceMonth" value={due.slice(0, 7)} />
          <Input
            id="ob-due"
            name="currentInvoiceDue"
            type="date"
            required
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </Field>
      ) : (
        <Field
          label="Fatura em que a parcela atual cai"
          htmlFor="ob-invoice"
          hint="Mês de vencimento da fatura. As próximas parcelas vão nas faturas seguintes."
        >
          <MonthField
            id="ob-invoice"
            name="currentInvoiceMonth"
            required
            around={currentMonth}
            defaultValue={currentMonth}
          />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoria" htmlFor="ob-cat">
          <CategoryPicker
            id="ob-cat"
            name="categoryId"
            options={categories.filter((c) => c.kind === 'EXPENSE')}
            value={categoryId}
            onChange={setCategoryId}
          />
        </Field>
        <Field label="De quem é" htmlFor="ob-ben">
          <NativeSelect id="ob-ben" name="beneficiaryUserId" defaultValue="">
            <option value="">Casal</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        Só as parcelas restantes entram no limite e nas faturas. A compra não conta no Gasto Bruto dos meses
        passados.
      </p>
      <FormError message={state && !state.ok ? state.error : null} />
      {/* cadastrar: o botão fica sempre à vista, acima da barra inferior e do teclado */}
      <StickyActions>
        <Button type="submit" className="h-11" disabled={pending}>
          {pending ? 'Salvando…' : 'Cadastrar parcelamento'}
        </Button>
      </StickyActions>
    </form>
  );
}
