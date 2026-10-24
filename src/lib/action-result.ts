/** Contrato das Server Actions: nunca lançam para o cliente. */
export type ActionFailure = {
  ok: false;
  error: string;
  /** dados que a tela usa para pedir o que falta (ex.: fundingShortCents = aporte mínimo exigido) */
  details?: Record<string, number>;
};
export type ActionResult<T> = { ok: true; data: T } | ActionFailure;

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const fail = (error: string, details?: Record<string, number>): ActionFailure =>
  details ? { ok: false, error, details } : { ok: false, error };
