import NextAuth from 'next-auth';
import { authConfig } from './auth.config';

const { auth } = NextAuth(authConfig);

/** Exige sessão em tudo, exceto as rotas públicas de `isPublicPath` e os assets estáticos. */
export default auth;

export const config = {
  matcher: [
    '/((?!api/auth|api/webhooks|api/health|_next/static|_next/image|icons/|favicon.ico|icon.svg|manifest.webmanifest|sw.js).*)',
  ],
};
