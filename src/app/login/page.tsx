import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const { callbackUrl } = await searchParams;
  const target = typeof callbackUrl === 'string' ? toPath(callbackUrl) : '/';

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático pequeno */}
          <img src="/icon.svg" alt="" width={48} height={48} className="mx-auto mb-2 rounded-xl" />
          <CardTitle className="text-xl">Finah</CardTitle>
          <CardDescription>Controle financeiro do casal</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm callbackUrl={target} />
        </CardContent>
      </Card>
    </main>
  );
}

/** O Auth.js manda callbackUrl absoluto; guardamos só o caminho (nunca outro host). */
function toPath(url: string): string {
  try {
    const u = new URL(url, 'http://local');
    return `${u.pathname}${u.search}` || '/';
  } catch {
    return '/';
  }
}
