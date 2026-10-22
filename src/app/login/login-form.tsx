'use client';

import { useActionState, useState } from 'react';
import { RecoveryCodesList } from '@/components/auth/recovery-codes-list';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/lib/action-result';
import { login, type LoginStep } from './actions';

/** Login em duas etapas: senha → código do app autenticador (ou cadastro dele, no 1º login com 2FA). */
export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  // controlados: o React limpa o formulário depois de cada envio, e a senha precisa seguir para a 2ª etapa
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [flow, setFlow] = useState<LoginStep | null>(null);
  const [state, action, pending] = useActionState(
    async (prev: ActionResult<LoginStep> | null, fd: FormData) => {
      const r = await login(prev, fd);
      if (r.ok) setFlow(r.data);
      return r;
    },
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
          readOnly={flow !== null}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          readOnly={flow !== null}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {flow?.step === 'enroll' && (
        <div className="space-y-3 rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="font-medium">Ative a verificação em duas etapas</p>
          <p className="text-muted-foreground">
            1. No celular, abra um app autenticador (Google Authenticator, 1Password, Authy…) e leia o QR
            code.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- QR gerado no servidor (data URL) */}
          <img
            src={flow.qrDataUrl}
            alt="QR code para o app autenticador"
            width={220}
            height={220}
            className="mx-auto rounded-md bg-white p-2"
          />
          <p className="text-muted-foreground">
            Sem câmera? Digite a chave:{' '}
            <code data-testid="totp-secret" className="font-mono text-xs break-all text-foreground">
              {flow.secret}
            </code>
          </p>
          <p className="text-muted-foreground">
            2. Guarde os códigos de recuperação num lugar seguro (gerenciador de senhas). Cada um entra uma
            vez, se você perder o celular.
          </p>
          <RecoveryCodesList codes={flow.recoveryCodes} />
          <p className="text-muted-foreground">3. Digite abaixo o código de 6 dígitos que o app mostra.</p>
        </div>
      )}

      {flow && (
        <div className="space-y-2">
          <Label htmlFor="code">Código</Label>
          <Input
            id="code"
            name="code"
            autoComplete="one-time-code"
            inputMode={flow.step === 'enroll' ? 'numeric' : 'text'}
            required
            autoFocus
            maxLength={20}
            placeholder="123456"
          />
          {flow.step === 'code' && (
            <p className="text-xs text-muted-foreground">
              Os 6 dígitos do app autenticador, ou um código de recuperação.
            </p>
          )}
        </div>
      )}

      {state && !state.ok && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="h-11 w-full" disabled={pending}>
        {pending
          ? 'Aguarde…'
          : flow === null
            ? 'Continuar'
            : flow.step === 'enroll'
              ? 'Ativar e entrar'
              : 'Entrar'}
      </Button>
      {flow && (
        <Button type="button" variant="ghost" className="w-full" onClick={() => setFlow(null)}>
          Voltar
        </Button>
      )}
    </form>
  );
}
