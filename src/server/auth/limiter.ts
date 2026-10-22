import { LoginRateLimiter } from './rate-limit';

const globalForLimiter = globalThis as unknown as { __finahLoginLimiter?: LoginRateLimiter };

/** Um limitador só por processo, compartilhado entre a 1ª etapa (senha) e o authorize (senha + código). */
export function loginLimiter(): LoginRateLimiter {
  return (globalForLimiter.__finahLoginLimiter ??= new LoginRateLimiter());
}
