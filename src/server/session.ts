import { auth } from '@/auth';
import { getDb } from '@/db/client';
import { today } from '@/domain/dates';
import { type ServiceCtx, UserError } from './context';

/** Contexto de serviço da requisição atual: usuário da sessão, banco e hoje (America/Sao_Paulo). */
export async function getServiceCtx(): Promise<ServiceCtx> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new UserError('Sua sessão expirou. Entre de novo.');
  return { db: getDb(), userId, today: today() };
}
