import { auth } from '@/auth';
import { getDb } from '@/db/client';
import { today } from '@/domain/dates';
import { validSession, type ValidSession } from './auth/session-check';
import { type ServiceCtx, UserError } from './context';

export type SessionUser = ValidSession;

/** Usuário da sessão, só se a sessão ainda vale (ver validSession). */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  return validSession(getDb(), session?.user?.id, session?.sessionVersion);
}

/** Contexto de serviço da requisição atual: usuário da sessão, banco e hoje (America/Sao_Paulo). */
export async function getServiceCtx(): Promise<ServiceCtx> {
  const user = await currentUser();
  if (!user) throw new UserError('Sua sessão expirou. Entre de novo.');
  return { db: getDb(), userId: user.id, today: today() };
}
