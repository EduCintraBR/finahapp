import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { getDb } from '@/db/client';
import { validSession } from '@/server/auth/session-check';
import { authConfig, isPublicPath } from './auth.config';
import { buildCsp } from './lib/csp';

const { auth } = NextAuth(authConfig);

/**
 * Exige sessão em tudo, exceto as rotas públicas de `isPublicPath` e os assets estáticos (o callback
 * `authorized` decide antes desta função), confere se a sessão ainda vale (senha trocada, "sair de todos os
 * aparelhos", sessão de antes do 2FA → /sair) e põe o CSP com um nonce novo em cada página.
 */
export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  if (req.auth?.user && !isPublicPath(pathname) && pathname !== '/sair') {
    const valid = await validSession(getDb(), req.auth.user.id, req.auth.sessionVersion);
    if (!valid) {
      if (pathname.startsWith('/api/')) {
        return Response.json({ ok: false, error: 'Sessão expirada.' }, { status: 401 });
      }
      return NextResponse.redirect(new URL('/sair', req.nextUrl));
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV === 'development',
    https: (process.env.AUTH_URL ?? '').startsWith('https://'),
  });
  // o Next lê o CSP da requisição para pôr o nonce nos scripts dele; o layout lê o x-nonce para o script do tema
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
});

export const config = {
  matcher: [
    '/((?!api/auth|api/webhooks|api/health|_next/static|_next/image|icons/|favicon.ico|icon.svg|manifest.webmanifest|sw.js).*)',
  ],
};
