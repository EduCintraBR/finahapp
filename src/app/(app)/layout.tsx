import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { monthStart, today } from '@/domain/dates';
import { currentUser } from '@/server/session';

// Tudo aqui depende da sessão e do banco: nunca pré-renderizar no build.
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  // O proxy já barra quem não tem sessão; aqui também cai a sessão que não vale mais (senha trocada,
  // "sair de todos os aparelhos", sessão de antes do 2FA): /sair limpa o cookie e volta para o login.
  const user = await currentUser();
  if (!user) redirect('/sair');

  return (
    <AppShell user={{ name: user.name }} currentMonth={monthStart(today())}>
      {children}
    </AppShell>
  );
}
