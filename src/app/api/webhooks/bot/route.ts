import { webhookCallback } from 'grammy';
import { botConfig } from '@/bot/bot';
import { createRealBot } from '@/bot/runtime';
import { getDb } from '@/db/client';

export const dynamic = 'force-dynamic';

type Handler = (req: Request) => Promise<Response>;
const globalForBot = globalThis as unknown as { __finahBotWebhook?: Handler };

/**
 * Webhook do Telegram (BOT_MODE=webhook). O grammY valida o header
 * X-Telegram-Bot-Api-Secret-Token contra TELEGRAM_WEBHOOK_SECRET (401 se não bater).
 * Com o bot desligado, a rota responde 404.
 */
export async function POST(req: Request) {
  const cfg = botConfig();
  if (cfg.mode !== 'webhook' || !cfg.token || !cfg.webhookSecret) {
    return new Response('Not Found', { status: 404 });
  }
  globalForBot.__finahBotWebhook ??= webhookCallback(createRealBot(cfg.token, getDb()), 'std/http', {
    secretToken: cfg.webhookSecret,
    // A leitura pelo LLM pode levar alguns segundos; o Telegram reenvia se demorar
    // (o update_id único evita lançamento duplicado).
    timeoutMilliseconds: 55_000,
    onTimeout: 'return',
  });
  return globalForBot.__finahBotWebhook(req);
}
