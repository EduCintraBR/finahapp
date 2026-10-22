import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user'];
    /** versão da sessão gravada no login; null = sessão antiga (de antes do 2FA), que não vale mais */
    sessionVersion: number | null;
  }
  interface User {
    sessionVersion?: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sv?: number;
  }
}
