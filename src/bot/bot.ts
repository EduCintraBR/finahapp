/**
 * Adaptador grammY: traduz updates do Telegram para o service.ts e as respostas de volta.
 * Modos (BOT_MODE): webhook (VPS, rota /api/webhooks/bot) · polling (worker, NAS) · off (padrão).
 */
import { Bot, InlineKeyboard } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { type BotDeps, type BotReply, handleCallback, handleText } from './service';

export type BotMode = 'webhook' | 'polling' | 'off';

export function botConfig(env: Record<string, string | undefined> = process.env) {
  const mode = (['webhook', 'polling'].includes(env.BOT_MODE ?? '') ? env.BOT_MODE : 'off') as BotMode;
  return {
    mode,
    token: env.TELEGRAM_BOT_TOKEN || null,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || null,
  };
}

/** Botões em linhas de `columns` (padrão 3), na ordem recebida. */
const keyboard = (reply: BotReply) => {
  if (!reply.buttons?.length) return {};
  const per = reply.columns ?? 3;
  const kb = new InlineKeyboard();
  reply.buttons.forEach((b, i) => {
    if (i > 0 && i % per === 0) kb.row();
    kb.text(b.text, b.data);
  });
  return { reply_markup: kb };
};

export function createBot(token: string, deps: BotDeps, opts: { botInfo?: UserFromGetMe } = {}) {
  const bot = new Bot(token, opts.botInfo ? { botInfo: opts.botInfo } : undefined);

  bot.on('message:text', async (ctx) => {
    const reply = await handleText(deps, {
      updateId: ctx.update.update_id,
      chatId: ctx.chat.id,
      telegramUserId: ctx.from.id,
      text: ctx.message.text,
    });
    if (reply) await ctx.reply(reply.text, keyboard(reply));
  });

  bot.on('callback_query:data', async (ctx) => {
    const reply = await handleCallback(deps, { telegramUserId: ctx.from.id, data: ctx.callbackQuery.data });
    await ctx.answerCallbackQuery();
    if (!reply) return;
    // Tira os botões da mensagem anterior para não haver toque duplo.
    await ctx.editMessageReplyMarkup().catch(() => {});
    await ctx.reply(reply.text, keyboard(reply));
  });

  bot.catch((err) => {
    console.error('[bot] erro ao tratar update', err.ctx.update.update_id, err.error);
  });

  return bot;
}
