import type { NextAuthConfig } from 'next-auth';

/** Rotas acessíveis sem sessão. Todo o resto exige login. */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/api/webhooks/') ||
    pathname.startsWith('/api/auth/') ||
    pathname === '/api/health'
  );
}

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Parte da configuração sem banco de dados, usada pelo proxy (src/proxy.ts).
 * Os providers (com acesso ao banco) ficam em src/auth.ts.
 */
export const authConfig = {
  trustHost: true, // self-hosted atrás do nginx
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const loggedIn = Boolean(auth?.user);
      if (pathname === '/login' && loggedIn) return Response.redirect(new URL('/', request.nextUrl));
      if (isPublicPath(pathname)) return true;
      if (!loggedIn && pathname.startsWith('/api/')) {
        return Response.json({ ok: false, error: 'Não autenticado.' }, { status: 401 });
      }
      return loggedIn; // false → redireciona para /login?callbackUrl=...
    },
    jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        token.sv = user.sessionVersion; // conferido a cada página/ação contra users.session_version
      }
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.sessionVersion = typeof token.sv === 'number' ? token.sv : null;
      return session;
    },
  },
} satisfies NextAuthConfig;
