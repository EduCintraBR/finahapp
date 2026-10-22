import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { getDb } from '@/db/client';
import { authConfig } from './auth.config';
import { authenticate, clientIp } from './server/auth/authenticate';
import { loginLimiter } from './server/auth/limiter';
import { appKey } from './server/auth/secret-box';

export class RateLimitedSignin extends CredentialsSignin {
  override code = 'rate_limited';
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {}, code: {} },
      async authorize(credentials, request) {
        const result = await authenticate(
          getDb(),
          loginLimiter(),
          {
            email: credentials?.email,
            password: credentials?.password,
            code: credentials?.code,
            ip: clientIp(request.headers),
          },
          { key: appKey(), nowMs: Date.now() },
        );
        if (result.ok) return result.user;
        if (result.reason === 'rate_limited') throw new RateLimitedSignin();
        return null;
      },
    }),
  ],
});
