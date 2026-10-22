import type { Metadata } from 'next';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { eq } from 'drizzle-orm';
import { auth, signOut } from '@/auth';
import { Button } from '@/components/ui/button';
import { OpeningBalanceForm } from '@/components/settings/opening-balance-form';
import { ThemeSwitch } from '@/components/theme/theme-controls';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { bankAccounts, users } from '@/db/schema';
import {
  ChangeAuthenticatorForm,
  ChangePasswordForm,
  LogoutEverywhereButton,
  RecoveryCodesForm,
} from '@/components/settings/security-forms';

export const metadata: Metadata = { title: 'Ajustes' };

const formatDateTimeBR = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d);
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await auth();
  const [account] = await getDb().select().from(bankAccounts).where(eq(bankAccounts.isPrimary, true));
  const [mfa] = session?.user?.id
    ? await getDb()
        .select({ enabledAt: users.totpEnabledAt, codes: users.recoveryCodeHashes })
        .from(users)
        .where(eq(users.id, session.user.id))
    : [];

  async function logout() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
      <Card>
        <CardHeader>
          <CardTitle>{session?.user?.name}</CardTitle>
          <CardDescription>{session?.user?.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={logout}>
            <Button type="submit" variant="outline" className="w-full sm:w-auto">
              <LogOut aria-hidden /> Sair
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Segurança</CardTitle>
          <CardDescription>
            Verificação em duas etapas ativa
            {mfa?.enabledAt ? ` desde ${formatDateTimeBR(mfa.enabledAt)}` : ''} · {mfa?.codes.length ?? 0}{' '}
            código(s) de recuperação sobrando.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <details className="rounded-lg border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Trocar senha</summary>
            <div className="px-3 pb-3">
              <ChangePasswordForm />
            </div>
          </details>
          <details className="rounded-lg border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              Novos códigos de recuperação
            </summary>
            <div className="px-3 pb-3">
              <RecoveryCodesForm />
            </div>
          </details>
          <details className="rounded-lg border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              Trocar de app autenticador
            </summary>
            <div className="px-3 pb-3">
              <ChangeAuthenticatorForm />
            </div>
          </details>
          <LogoutEverywhereButton />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Aparência</CardTitle>
          <CardDescription>Vale só para este aparelho. O padrão é o tema escuro.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeSwitch />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Categorias</CardTitle>
          <CardDescription>Crie, renomeie, ajuste os apelidos do bot ou arquive categorias.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/ajustes/categorias">Gerenciar categorias</Link>
          </Button>
        </CardContent>
      </Card>
      {account && (
        <Card>
          <CardHeader>
            <CardTitle>Conta principal</CardTitle>
            <CardDescription>{account.name}</CardDescription>
          </CardHeader>
          <CardContent>
            <OpeningBalanceForm amountCents={account.openingBalanceCents} date={account.openingBalanceDate} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
