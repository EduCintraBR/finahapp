/**
 * Container `worker`: jobs em pg-boss (mesma imagem do app, outro entrypoint).
 * - heartbeat (30 min): prova de vida.
 * - recurring-generate (todo dia 00:05 e ao subir): materializa as ocorrências de fixos (Fase 2).
 * - bot do Telegram em polling, se BOT_MODE=polling (na VPS o padrão é webhook, no app).
 * - bot-reminders (todo dia 9h): contas que vencem hoje e faturas que vencem em 2 dias (D43),
 *   para os usuários com Telegram. Só com o bot ligado (BOT_MODE ≠ off) e token definido.
 */
import { Api } from 'grammy';
import { PgBoss } from 'pg-boss';
import { botConfig } from '@/bot/bot';
import { sendReminders } from '@/bot/reports';
import { createRealBot } from '@/bot/runtime';
import { createDb } from '@/db/client';
import { DEFAULT_TZ, today } from '@/domain/dates';
import { generateOccurrences } from '@/server/recurring';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[worker] DATABASE_URL não definida.');
  process.exit(1);
}

const boss = new PgBoss({ connectionString: url, schema: 'pgboss' });
boss.on('error', (err) => console.error('[worker] erro no pg-boss:', err));

await boss.start();

const HEARTBEAT = 'heartbeat';
await boss.createQueue(HEARTBEAT);
await boss.schedule(HEARTBEAT, '*/30 * * * *', null, { tz: DEFAULT_TZ });
await boss.work(HEARTBEAT, async () => {
  console.log(`[worker] heartbeat ${new Date().toISOString()}`);
});

const { db } = createDb(url, { max: 2 });
const GENERATE = 'recurring-generate';
await boss.createQueue(GENERATE);
// Diário (não só no dia 1º): se o worker ficou fora do ar, o próximo dia recupera (idempotente).
await boss.schedule(GENERATE, '5 0 * * *', null, { tz: DEFAULT_TZ });
await boss.work(GENERATE, async () => {
  const created = await generateOccurrences(db, today());
  console.log(`[worker] ocorrências geradas: ${created}`);
});
await boss.send(GENERATE, null);

console.log('[worker] pg-boss iniciado.');

const botCfg = botConfig();
const REMINDERS = 'bot-reminders';
if (botCfg.mode !== 'off' && botCfg.token) {
  const api = new Api(botCfg.token);
  await boss.createQueue(REMINDERS);
  await boss.schedule(REMINDERS, '0 9 * * *', null, { tz: DEFAULT_TZ });
  await boss.work(REMINDERS, async () => {
    const sent = await sendReminders(db, today(), (chatId, text) => api.sendMessage(chatId, text));
    console.log(`[worker] lembretes enviados: ${sent}`);
  });
} else {
  await boss.unschedule(REMINDERS).catch(() => {});
}

// Bot em long polling (NAS, ou testes locais): só com BOT_MODE=polling e token definido.
const bot = botCfg.mode === 'polling' && botCfg.token ? createRealBot(botCfg.token, db) : null;
if (bot) {
  await bot.api.deleteWebhook(); // polling e webhook não convivem
  void bot.start({ onStart: (me) => console.log(`[worker] bot @${me.username} em polling.`) });
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal} recebido, encerrando…`);
  await bot?.stop();
  await boss.stop({ graceful: true, timeout: 10_000 });
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
