'use client';

import { useActionState, useState } from 'react';
import { saveCardAction } from '@/app/(app)/cartoes/actions';
import { Field, FormError, MoneyInput } from '@/components/forms/fields';
import { StickyActions } from '@/components/forms/sticky-actions';
import { Button } from '@/components/ui/button';
import { useActionDone } from '@/components/ui/sheet-action';
import { Input } from '@/components/ui/input';
import { suggestClosingDay } from '@/domain/card/invoices';
import { DEFAULT_STORE_CREDIT_TERMS } from '@/domain/card/store-credit';

export type CardDefaults = {
  id: string;
  kind: 'CARD' | 'STORE_CREDIT';
  name: string;
  issuer: string | null;
  last4: string | null;
  isAdditional: boolean;
  holderName: string | null;
  limitText: string;
  closingDay: number | null;
  dueDay: number;
  firstDueDays: number | null;
  closeBeforeDays: number | null;
  botAliases: string[];
};

/** Cadastro de cartão ou de crediário (D73: crédito de loja, com prazo da 1ª fatura em vez de dias fixos). */
export function CardForm({
  defaults,
  kind = defaults?.kind ?? 'CARD',
}: {
  defaults?: CardDefaults;
  kind?: 'CARD' | 'STORE_CREDIT';
}) {
  const [state, action, pending] = useActionState(saveCardAction, null);
  const store = kind === 'STORE_CREDIT';
  const noun = store ? 'crediário' : 'cartão';
  useActionDone(state, defaults ? (store ? 'Crediário salvo.' : 'Cartão salvo.') : undefined);
  const [additional, setAdditional] = useState(defaults?.isAdditional ?? false);

  return (
    <form action={action} className="space-y-4">
      {defaults && <input type="hidden" name="id" value={defaults.id} />}
      <input type="hidden" name="kind" value={kind} />
      <Field label="Nome" htmlFor="c-name" hint={store ? 'O nome da loja e do crédito' : undefined}>
        <Input
          id="c-name"
          name="name"
          required
          maxLength={80}
          placeholder={store ? 'Ex.: Shopee Parcelado' : 'Ex.: Nubank Eduardo'}
          defaultValue={defaults?.name}
        />
      </Field>

      {store ? <StoreCreditTermsFields defaults={defaults} /> : <CardTermsFields defaults={defaults} />}

      {!store && (
        <>
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
        </>
      )}

      <Field
        label="Limite"
        htmlFor="c-limit"
        hint={
          store
            ? 'O limite que a loja liberou para você.'
            : additional
              ? 'Deixe em branco se o limite é compartilhado com o titular (o app mostra só o comprometido). Preencha se o titular definiu um sub-limite.'
              : 'O limite total do cartão no app do banco.'
        }
      >
        <MoneyInput
          id="c-limit"
          name="limitTotal"
          required={store || !additional}
          defaultValue={defaults?.limitText}
        />
      </Field>

      <Field
        label="Apelidos para o bot"
        htmlFor="c-aliases"
        hint={store ? 'Separados por vírgula. Ex.: shopee' : 'Separados por vírgula. Ex.: nubank, roxinho'}
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
          {store ? 'Mudar o prazo' : 'Mudar os dias'} só vale para faturas que ainda não existem. Para uma
          fatura já gerada, edite as datas na tela dela.
        </p>
      )}
      <FormError message={state && !state.ok ? state.error : null} />
      {defaults ? (
        <Button type="submit" className="h-11 w-full" disabled={pending}>
          {pending ? 'Salvando…' : `Salvar ${noun}`}
        </Button>
      ) : (
        <StickyActions>
          <Button type="submit" className="h-11" disabled={pending}>
            {pending ? 'Salvando…' : `Cadastrar ${noun}`}
          </Button>
        </StickyActions>
      )}
    </form>
  );
}

function CardTermsFields({ defaults }: { defaults?: CardDefaults }) {
  const [dueDay, setDueDay] = useState(String(defaults?.dueDay ?? 10));
  const [closingDay, setClosingDay] = useState(String(defaults?.closingDay ?? 3));
  const [closingTouched, setClosingTouched] = useState(Boolean(defaults));
  return (
    <>
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
    </>
  );
}

/** D73: a 1ª compra abre uma fatura que vence em N dias; ela fecha X dias antes do vencimento. */
function StoreCreditTermsFields({ defaults }: { defaults?: CardDefaults }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Prazo da 1ª fatura" htmlFor="c-first-due" hint="Dias da 1ª compra até o vencimento">
        <Input
          id="c-first-due"
          name="firstDueDays"
          type="number"
          inputMode="numeric"
          min={2}
          max={120}
          required
          defaultValue={defaults?.firstDueDays ?? DEFAULT_STORE_CREDIT_TERMS.firstDueDays}
        />
      </Field>
      <Field
        label="Fecha antes do vencimento"
        htmlFor="c-close-before"
        hint="Dias; depois disso a compra vai para a próxima"
      >
        <Input
          id="c-close-before"
          name="closeBeforeDays"
          type="number"
          inputMode="numeric"
          min={1}
          max={119}
          required
          defaultValue={defaults?.closeBeforeDays ?? DEFAULT_STORE_CREDIT_TERMS.closeBeforeDays}
        />
      </Field>
    </div>
  );
}
