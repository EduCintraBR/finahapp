'use client';

import { useActionState, useState } from 'react';
import { saveCardAction } from '@/app/(app)/cartoes/actions';
import { Field, FormError, MoneyInput } from '@/components/forms/fields';
import { StickyActions } from '@/components/forms/sticky-actions';
import { Button } from '@/components/ui/button';
import { useActionDone } from '@/components/ui/sheet-action';
import { Input } from '@/components/ui/input';
import { suggestClosingDay } from '@/domain/card/invoices';

export type CardDefaults = {
  id: string;
  name: string;
  issuer: string | null;
  last4: string | null;
  isAdditional: boolean;
  holderName: string | null;
  limitText: string;
  closingDay: number;
  dueDay: number;
  botAliases: string[];
};

export function CardForm({ defaults }: { defaults?: CardDefaults }) {
  const [state, action, pending] = useActionState(saveCardAction, null);
  useActionDone(state, defaults ? 'Cartão salvo.' : undefined);
  const [additional, setAdditional] = useState(defaults?.isAdditional ?? false);
  const [dueDay, setDueDay] = useState(String(defaults?.dueDay ?? 10));
  const [closingDay, setClosingDay] = useState(String(defaults?.closingDay ?? 3));
  const [closingTouched, setClosingTouched] = useState(Boolean(defaults));

  return (
    <form action={action} className="space-y-4">
      {defaults && <input type="hidden" name="id" value={defaults.id} />}
      <Field label="Nome" htmlFor="c-name">
        <Input
          id="c-name"
          name="name"
          required
          maxLength={80}
          placeholder="Ex.: Nubank Eduardo"
          defaultValue={defaults?.name}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Banco" htmlFor="c-issuer">
          <Input
            id="c-issuer"
            name="issuer"
            maxLength={60}
            placeholder="Nubank"
            defaultValue={defaults?.issuer ?? ''}
          />
        </Field>
        <Field label="Final" htmlFor="c-last4" hint="Opcional">
          <Input
            id="c-last4"
            name="last4"
            inputMode="numeric"
            maxLength={4}
            placeholder="1234"
            defaultValue={defaults?.last4 ?? ''}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Dia do vencimento" htmlFor="c-due">
          <Input
            id="c-due"
            name="dueDay"
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            required
            value={dueDay}
            onChange={(e) => {
              setDueDay(e.target.value);
              const d = Number(e.target.value);
              if (!closingTouched && d >= 1 && d <= 31) setClosingDay(String(suggestClosingDay(d)));
            }}
          />
        </Field>
        <Field label="Dia do fechamento" htmlFor="c-closing" hint="Nubank: 7 dias antes do vencimento">
          <Input
            id="c-closing"
            name="closingDay"
            type="number"
            inputMode="numeric"
            min={1}
            max={31}
            required
            value={closingDay}
            onChange={(e) => {
              setClosingDay(e.target.value);
              setClosingTouched(true);
            }}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isAdditional"
          checked={additional}
          onChange={(e) => setAdditional(e.target.checked)}
          className="size-4 accent-primary"
        />
        Cartão adicional de outra pessoa (titular)
      </label>
      {additional && (
        <Field label="Titular" htmlFor="c-holder">
          <Input
            id="c-holder"
            name="holderName"
            required
            maxLength={80}
            placeholder="Ex.: Mãe"
            defaultValue={defaults?.holderName ?? ''}
          />
        </Field>
      )}

      <Field
        label="Limite"
        htmlFor="c-limit"
        hint={
          additional
            ? 'Deixe em branco se o limite é compartilhado com o titular (o app mostra só o comprometido). Preencha se o titular definiu um sub-limite.'
            : 'O limite total do cartão no app do banco.'
        }
      >
        <MoneyInput
          id="c-limit"
          name="limitTotal"
          required={!additional}
          defaultValue={defaults?.limitText}
        />
      </Field>

      <Field
        label="Apelidos para o bot"
        htmlFor="c-aliases"
        hint="Separados por vírgula. Ex.: nubank, roxinho"
      >
        <Input
          id="c-aliases"
          name="botAliases"
          maxLength={400}
          defaultValue={defaults?.botAliases.join(', ')}
        />
      </Field>

      {defaults && (
        <p className="text-xs text-muted-foreground">
          Mudar os dias só vale para faturas que ainda não existem. Para uma fatura já gerada, edite as datas
          na tela dela.
        </p>
      )}
      <FormError message={state && !state.ok ? state.error : null} />
      {defaults ? (
        <Button type="submit" className="h-11 w-full" disabled={pending}>
          {pending ? 'Salvando…' : 'Salvar cartão'}
        </Button>
      ) : (
        <StickyActions>
          <Button type="submit" className="h-11" disabled={pending}>
            {pending ? 'Salvando…' : 'Cadastrar cartão'}
          </Button>
        </StickyActions>
      )}
    </form>
  );
}
