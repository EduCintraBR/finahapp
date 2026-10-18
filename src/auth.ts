import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { getDb } from '@/db/client';
import { authConfig } from './auth.config';
import { authenticate, clientIp } from './server/auth/authenticate';
import { LoginRateLimiter } from './server/auth/rate-limit';

export class RateLimitedSignin extends CredentialsSignin {
  override code = 'rate_limited';
}

const globalForLimiter = globalThis as unknown as { __finahLoginLimiter?: LoginRateLimiter };
const limiter = (globalForLimiter.__finahLoginLimiter ??= new LoginRateLimiter());

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials, request) {
        const result = await authenticate(getDb(), limiter, {
          email: credentials?.email,
          password: credentials?.password,
          ip: clientIp(request.headers),
        });
        if (result.ok) return result.user;
        if (result.reason === 'rate_limited') throw new RateLimitedSignin();
        return null;
      },
    }),
  ],
});
