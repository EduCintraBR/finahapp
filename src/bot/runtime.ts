import type { AnyDB } from '@/db/client';
import { today } from '@/domain/dates';
import { createBot } from './bot';
import { createClaudeParser } from './parser';
import type { BotDeps } from './service';

/** Dependências reais do bot (Claude + relógio do sistema em America/Sao_Paulo). */
export function realBotDeps(db: AnyDB): BotDeps {
  return { db, parser: createClaudeParser(), today: () => today(), now: () => new Date() };
}

export function createRealBot(token: string, db: AnyDB) {
  return createBot(token, realBotDeps(db));
}
