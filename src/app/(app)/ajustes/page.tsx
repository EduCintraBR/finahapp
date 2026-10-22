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
import { bankAccounts } from '@/db/schema';

export const metadata: Metadata = { title: 'Ajustes' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await auth();
  const [account] = await getDb().select().from(bankAccounts).where(eq(bankAccounts.isPrimary, true));

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
