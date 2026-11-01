'use client';

import { useActionState, useState } from 'react';
import {
  createBenefitCardAction,
  endBenefitCardAction,
  updateBenefitCardAction,
} from '@/app/(app)/beneficios/actions';
import { Field, FormError, MoneyInput } from '@/components/forms/fields';
import { StickyActions } from '@/components/forms/sticky-actions';
import { MonthField } from '@/components/forms/month-field';
import { Button } from '@/components/ui/button';
import { useActionDone } from '@/components/ui/sheet-action';
import { Input } from '@/components/ui/input';
import { MAX_BENEFIT_WALLETS } from '@/domain/benefits/credits';

const PRESET_WALLETS = ['Multibenefícios', 'Refeição e alimentação'];

type Rule = 'LAST_BUSINESS_DAY' | 'DAY_OF_MONTH';

function CreditRuleFields({
  rule,
  setRule,
  day,
}: {
  rule: Rule;
  setRule: (r: Rule) => void;
  day?: number | null;
}) {
  return (
    <div className="space-y-2">
      <Field label="Quando o crédito cai" htmlFor="creditRule">
        <select
          id="creditRule"
          name="creditRule"
          value={rule}
          onChange={(e) => setRule(e.target.value as Rule)}
          className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
        >
          <option value="LAST_BUSINESS_DAY">No último dia útil do mês</option>
          <option value="DAY_OF_MONTH">Em um dia fixo do mês</option>
        </select>
      </Field>
      {rule === 'DAY_OF_MONTH' && (
        <Field label="Dia do crédito" htmlFor="creditDay" hint="Mês sem esse dia: cai no último dia do mês.">
          <Input
            id="creditDay"
            name="creditDay"
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            required
            defaultValue={day ?? undefined}
          />
        </Field>
      )}
      {rule === 'LAST_BUSINESS_DAY' && (
        <p className="text-xs text-muted-foreground">
          Último dia útil = último dia de segunda a sexta (o app não conhece feriados).
        </p>
      )}
    </div>
  );
}

/** Cadastro do cartão de benefícios: dados, quando o crédito cai e as carteiras (valor mensal + saldo de hoje). */
export function BenefitCardForm({ defaultStartMonth }: { defaultStartMonth: string }) {
  const [state, action, pending] = useActionState(createBenefitCardAction, null);
  const [rule, setRule] = useState<Rule>('LAST_BUSINESS_DAY');
  const [wallets, setWallets] = useState<string[]>(PRESET_WALLETS);

  return (
    <form action={action} className="space-y-4">
      <Field label="Nome do cartão" htmlFor="b-name" hint="Ex.: Multibenefícios da empresa">
        <Input id="b-name" name="name" required maxLength={80} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Emissor (opcional)" htmlFor="b-issuer">
          <Input id="b-issuer" name="issuer" maxLength={60} placeholder="Alelo, Flash…" />
        </Field>
        <Field label="Final (opcional)" htmlFor="b-last4">
          <Input id="b-last4" name="last4" inputMode="numeric" maxLength={4} placeholder="1234" />
        </Field>
      </div>

      <CreditRuleFields rule={rule} setRule={setRule} />

      <Field
        label="Primeiro crédito automático em"
        htmlFor="b-start"
        hint="O mês do primeiro crédito que ainda vai cair. O que já caiu vai no saldo de hoje, abaixo."
      >
        <MonthField
          id="b-start"
          name="startMonth"
          required
          around={defaultStartMonth}
          defaultValue={defaultStartMonth}
        />
      </Field>

      <div className="space-y-3">
        <div>
          <div className="text-sm font-medium">Carteiras</div>
          <p className="text-xs text-muted-foreground">
            Cada carteira tem o próprio saldo e o próprio crédito mensal (ex.: R$ 1.500,00 multibenefícios e
            R$ 704,00 refeição). O crédito entra como receita; o saldo de hoje é o que você já tem no cartão
            agora.
          </p>
        </div>
        {wallets.map((name, i) => (
          <fieldset key={i} className="space-y-3 rounded-lg border p-3">
            <Field label="Nome da carteira" htmlFor={`w${i}name`}>
              <Input
                id={`w${i}name`}
                name={`w${i}name`}
                maxLength={80}
                defaultValue={name}
                required={i === 0}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Crédito mensal" htmlFor={`w${i}credit`}>
                <MoneyInput id={`w${i}credit`} name={`w${i}credit`} />
              </Field>
              <Field label="Saldo de hoje" htmlFor={`w${i}opening`}>
                <MoneyInput id={`w${i}opening`} name={`w${i}opening`} />
              </Field>
            </div>
            {i > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setWallets((w) => w.filter((_, j) => j !== i))}
              >
                Remover carteira
              </Button>
            )}
          </fieldset>
        ))}
        {wallets.length < MAX_BENEFIT_WALLETS && (
          <Button type="button" variant="outline" size="sm" onClick={() => setWallets((w) => [...w, ''])}>
            + Outra carteira
          </Button>
        )}
      </div>

      <FormError message={state && !state.ok ? state.error : null} />
      {/* cadastrar: o botão fica sempre à vista, acima da barra inferior e do teclado */}
      <StickyActions>
        <Button type="submit" className="h-11" disabled={pending}>
          {pending ? 'Salvando…' : 'Cadastrar cartão'}
        </Button>
      </StickyActions>
    </form>
  );
}

export function BenefitEditForm({
  id,
  defaults,
  wallets,
}: {
  id: string;
  defaults: { name: string; issuer: string | null; last4: string | null; rule: Rule; day: number | null };
  wallets: { id: string; name: string; creditText: string }[];
}) {
  const [state, action, pending] = useActionState(updateBenefitCardAction, null);
  useActionDone(state, 'Cartão salvo.');
  const [rule, setRule] = useState<Rule>(defaults.rule);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Field label="Nome do cartão" htmlFor="e-name">
        <Input id="e-name" name="name" required maxLength={80} defaultValue={defaults.name} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Emissor" htmlFor="e-issuer">
          <Input id="e-issuer" name="issuer" maxLength={60} defaultValue={defaults.issuer ?? ''} />
        </Field>
        <Field label="Final" htmlFor="e-last4">
          <Input
            id="e-last4"
            name="last4"
            inputMode="numeric"
            maxLength={4}
            defaultValue={defaults.last4 ?? ''}
          />
        </Field>
      </div>
      <CreditRuleFields rule={rule} setRule={setRule} day={defaults.day} />
      {wallets.map((w) => (
        <div key={w.id}>
          <input type="hidden" name="walletId" value={w.id} />
          <Field label={`Crédito mensal · ${w.name}`} htmlFor={`e-${w.id}`}>
            <MoneyInput id={`e-${w.id}`} name="walletCredit" required defaultValue={w.creditText} />
          </Field>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Vale para os próximos créditos. Os que já caíram não mudam.
      </p>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" variant="outline" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Salvando…' : 'Salvar'}
      </Button>
    </form>
  );
}

/** Encerrar: escolhe o último mês com crédito. Histórico, gastos e o saldo que sobrou continuam. */
export function EndBenefitForm({ id, defaultMonth }: { id: string; defaultMonth: string }) {
  const [state, action, pending] = useActionState(endBenefitCardAction, null);
  useActionDone(state, 'Cartão encerrado.');
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <Field
        label="Último mês com crédito"
        htmlFor="lastMonth"
        hint="Depois desse mês o app não credita mais. Nada é apagado: o histórico e o saldo que sobrar continuam, e dá para gastar o resto."
      >
        <MonthField
          id="lastMonth"
          name="lastMonth"
          required
          around={defaultMonth}
          defaultValue={defaultMonth}
        />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" variant="destructive" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Encerrando…' : 'Encerrar cartão'}
      </Button>
    </form>
  );
}
