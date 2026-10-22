import { signOut } from '@/auth';

export const dynamic = 'force-dynamic';

/**
 * Limpa uma sessão que não vale mais (senha trocada, "sair de todos os aparelhos", sessão de antes do 2FA) e
 * volta para o login. Sem isso, o proxy veria o cookie e mandaria /login de volta para a home (laço).
 */
export async function GET() {
  await signOut({ redirectTo: '/login' });
}
