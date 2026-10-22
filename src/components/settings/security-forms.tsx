'use client';

import { useActionState, useState } from 'react';
import {
  type AuthenticatorChange,
  changeAuthenticatorAction,
  changePasswordAction,
  logoutEverywhereAction,
  regenerateRecoveryCodesAction,
} from '@/app/(app)/ajustes/security-actions';
import { RecoveryCodesList } from '@/components/auth/recovery-codes-list';
import { ActionButton } from '@/components/forms/action-button';
import { Field, FormError } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ActionResult } from '@/lib/action-result';

const MIN = 12;

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, null);
  return (
    <form action={action} className="space-y-3">
      <Field label="Senha atual" htmlFor="pw-current">
        <Input id="pw-current" name="current" type="password" autoComplete="current-password" required />
      </Field>
      <Field
        label="Nova senha"
        htmlFor="pw-next"
        hint={`Pelo menos ${MIN} caracteres. Uma frase longa é ótima.`}
      >
        <Input
          id="pw-next"
          name="next"
          type="password"
          autoComplete="new-password"
          minLength={MIN}
          required
        />
      </Field>
      <Field label="Repita a nova senha" htmlFor="pw-confirm">
        <Input
          id="pw-confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={MIN}
          required
        />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <p className="text-xs text-muted-foreground">
        Ao trocar, todos os aparelhos saem e você entra de novo.
      </p>
      <Button type="submit" variant="outline" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Trocando…' : 'Trocar senha'}
      </Button>
    </form>
  );
}

export function LogoutEverywhereButton() {
  return (
    <ActionButton
      action={logoutEverywhereAction}
      fields={{}}
      label="Sair de todos os aparelhos"
      pendingLabel="Saindo…"
      confirm={{
        title: 'Sair de todos os aparelhos?',
        description:
          'Todas as sessões abertas (celulares, computadores, este aparelho) deixam de valer. Para entrar de novo: senha + código do autenticador.',
        confirmLabel: 'Sair de todos',
      }}
    />
  );
}

function CodeInput({ id, label, hint }: { id: string; label: string; hint?: string }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input id={id} name="code" autoComplete="one-time-code" required maxLength={20} placeholder="123456" />
    </Field>
  );
}

export function RecoveryCodesForm() {
  const [state, action, pending] = useActionState(
    regenerateRecoveryCodesAction,
    null as ActionResult<string[]> | null,
  );
  if (state?.ok) {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium">
          Novos códigos (os antigos não valem mais). Guarde agora: eles não aparecem de novo.
        </p>
        <RecoveryCodesList codes={state.data} />
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <CodeInput id="rc-code" label="Código do autenticador" hint="Para confirmar que é você." />
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" variant="outline" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Gerando…' : 'Gerar novos códigos'}
      </Button>
    </form>
  );
}

export function ChangeAuthenticatorForm() {
  const [pendingChange, setPendingChange] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [done, setDone] = useState(false);
  const [state, action, pending] = useActionState(
    async (prev: ActionResult<AuthenticatorChange> | null, fd: FormData) => {
      const r = await changeAuthenticatorAction(prev, fd);
      if (r.ok) {
        if ('done' in r.data) {
          setDone(true);
          setPendingChange(null);
        } else setPendingChange(r.data);
      }
      return r;
    },
    null,
  );

  if (done) return <p className="text-sm">Pronto: o app novo é o que vale agora. Pode apagar o antigo.</p>;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="stage" value={pendingChange ? 'confirm' : 'start'} />
      {pendingChange ? (
        <>
          <p className="text-sm text-muted-foreground">Leia o QR code no app novo (ou digite a chave):</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- QR gerado no servidor (data URL) */}
          <img
            src={pendingChange.qrDataUrl}
            alt="QR code para o novo app autenticador"
            width={220}
            height={220}
            className="mx-auto rounded-md bg-white p-2"
          />
          <code className="block text-center font-mono text-xs break-all">{pendingChange.secret}</code>
          <CodeInput key="new" id="ta-new" label="Código do app novo" />
        </>
      ) : (
        <CodeInput
          key="current"
          id="ta-current"
          label="Código do autenticador atual (ou de recuperação)"
          hint="Perdeu o celular? Use um código de recuperação."
        />
      )}
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" variant="outline" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Aguarde…' : pendingChange ? 'Confirmar troca' : 'Trocar de autenticador'}
      </Button>
    </form>
  );
}
