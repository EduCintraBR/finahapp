/**
 * Registra o webhook do bot no Telegram (rodar uma vez na VPS, depois do HTTPS no ar):
 *   pnpm bot:webhook            → aponta para ${AUTH_URL}/api/webhooks/bot
 *   pnpm bot:webhook --remove   → remove o webhook (ex.: antes de usar BOT_MODE=polling)
 */
import { Api } from 'grammy';

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const base = process.env.AUTH_URL;

if (!token) throw new Error('Defina TELEGRAM_BOT_TOKEN no .env.');
const api = new Api(token);

if (process.argv.includes('--remove')) {
  await api.deleteWebhook();
  console.log('Webhook removido.');
} else {
  if (!secret) throw new Error('Defina TELEGRAM_WEBHOOK_SECRET no .env (ex.: openssl rand -hex 32).');
  if (!base?.startsWith('https://'))
    throw new Error('Defina AUTH_URL com https:// (ex.: https://finahapp.com).');
  const url = `${base.replace(/\/$/, '')}/api/webhooks/bot`;
  await api.setWebhook(url, { secret_token: secret, allowed_updates: ['message', 'callback_query'] });
  console.log(`Webhook registrado em ${url}`);
  console.log(await api.getWebhookInfo());
}
