import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AppShell } from '@/components/layout/app-shell';
import { monthStart, today } from '@/domain/dates';

// Tudo aqui depende da sessão e do banco: nunca pré-renderizar no build.
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  // O proxy já barra quem não tem sessão; isto é a segunda linha de defesa.
  const session = await auth();
  if (!session?.user) redirect('/login');

  return (
    <AppShell user={{ name: session.user.name ?? '' }} currentMonth={monthStart(today())}>
      {children}
    </AppShell>
  );
}
