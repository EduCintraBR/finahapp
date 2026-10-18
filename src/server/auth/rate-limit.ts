/**
 * Rate limit de login em memória (o app roda em uma única instância).
 * Conta só FALHAS numa janela deslizante, por email e por IP:
 *  - por email: protege cada conta contra força bruta;
 *  - por IP: limite mais alto, porque os dois usuários costumam sair pelo mesmo IP de casa.
 * Login bem-sucedido zera o contador do email.
 */
export type LoginRateLimitOptions = {
  windowMs: number;
  maxFailuresPerEmail: number;
  maxFailuresPerIp: number;
  now?: () => number;
};

export const DEFAULT_LOGIN_LIMITS: LoginRateLimitOptions = {
  windowMs: 15 * 60 * 1000,
  maxFailuresPerEmail: 5,
  maxFailuresPerIp: 20,
};

export type RateLimitCheck = { allowed: true } | { allowed: false; retryAfterMs: number };

export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(private readonly opts: LoginRateLimitOptions = DEFAULT_LOGIN_LIMITS) {
    this.now = opts.now ?? Date.now;
  }

  check(ip: string, email: string): RateLimitCheck {
    const t = this.now();
    const retry = Math.max(
      this.retryAfter(`email:${email}`, this.opts.maxFailuresPerEmail, t),
      this.retryAfter(`ip:${ip}`, this.opts.maxFailuresPerIp, t),
    );
    return retry > 0 ? { allowed: false, retryAfterMs: retry } : { allowed: true };
  }

  recordFailure(ip: string, email: string): void {
    const t = this.now();
    for (const key of [`email:${email}`, `ip:${ip}`]) {
      const list = this.prune(key, t);
      list.push(t);
      this.failures.set(key, list);
    }
  }

  recordSuccess(email: string): void {
    this.failures.delete(`email:${email}`);
  }

  private prune(key: string, t: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((ts) => t - ts < this.opts.windowMs);
    if (list.length === 0) this.failures.delete(key);
    else this.failures.set(key, list);
    return list;
  }

  private retryAfter(key: string, max: number, t: number): number {
    const list = this.prune(key, t);
    if (list.length < max) return 0;
    // libera quando a falha mais antiga que ainda conta sair da janela
    const oldestCounting = list[list.length - max]!;
    return oldestCounting + this.opts.windowMs - t;
  }
}
