import type { AnyDB } from '@/db/client';
import type { ISODate } from '@/domain/dates';
import { type ActionResult, fail, ok } from '@/lib/action-result';

/** Tudo que um serviço precisa: banco, quem está agindo e "hoje" (injetável nos testes). */
export type ServiceCtx = { db: AnyDB; userId: string; today: ISODate };

export type Tx = Parameters<Parameters<AnyDB['transaction']>[0]>[0];

/** Erro de regra de negócio com mensagem pronta para o usuário (pt-BR). */
export class UserError extends Error {
  override name = 'UserError';
}

/** Executa um serviço e converte em ActionResult (Server Actions nunca lançam para o cliente). */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof UserError) return fail(err.message);
    console.error('[action] erro inesperado:', err);
    return fail('Não foi possível concluir agora. Tente de novo.');
  }
}

/** Converte soma BIGINT/NUMERIC do Postgres (string) em centavos, sem float. */
export function centsFromDb(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`Valor monetário inválido vindo do banco: ${value}`);
  return n;
}
