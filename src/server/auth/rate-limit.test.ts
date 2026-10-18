import { describe, expect, it } from 'vitest';
import { LoginRateLimiter } from './rate-limit';

const MIN = 60_000;

function setup() {
  let t = 1_000_000;
  const limiter = new LoginRateLimiter({
    windowMs: 15 * MIN,
    maxFailuresPerEmail: 3,
    maxFailuresPerIp: 5,
    now: () => t,
  });
  return { limiter, advance: (ms: number) => (t += ms) };
}

describe('LoginRateLimiter', () => {
  it('bloqueia o email após N falhas e libera quando a janela passa', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 3; i++) {
      expect(limiter.check('1.1.1.1', 'a@x').allowed).toBe(true);
      limiter.recordFailure('1.1.1.1', 'a@x');
      advance(MIN);
    }
    const blocked = limiter.check('1.1.1.1', 'a@x');
    expect(blocked).toEqual({ allowed: false, retryAfterMs: 12 * MIN });
    // outro email do mesmo IP ainda pode tentar
    expect(limiter.check('1.1.1.1', 'b@x').allowed).toBe(true);
    advance(12 * MIN);
    expect(limiter.check('1.1.1.1', 'a@x').allowed).toBe(true);
  });

  it('bloqueia o IP após muitas falhas em emails diferentes', () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) limiter.recordFailure('2.2.2.2', `u${i}@x`);
    expect(limiter.check('2.2.2.2', 'novo@x').allowed).toBe(false);
    expect(limiter.check('3.3.3.3', 'novo@x').allowed).toBe(true);
  });

  it('sucesso zera o contador do email', () => {
    const { limiter } = setup();
    limiter.recordFailure('1.1.1.1', 'a@x');
    limiter.recordFailure('1.1.1.1', 'a@x');
    limiter.recordSuccess('a@x');
    limiter.recordFailure('1.1.1.1', 'a@x');
    expect(limiter.check('1.1.1.1', 'a@x').allowed).toBe(true);
  });
});
