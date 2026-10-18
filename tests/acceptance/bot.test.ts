/**
 * Bot do Telegram (Fase 2) de ponta a ponta: grammY real com a API do Telegram simulada,
 * Postgres real (PGlite) e parser falso (sem chamar o LLM).
 */
import type { PGlite } from '@electric-sql/pglite';
import type { Update, UserFromGetMe } from 'grammy/types';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBot } from '@/bot/bot';
import { ParserUnavailableError, type ParsedEntry } from '@/bot/parser';
import type { AnyDB } from '@/db/client';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { reminderText, sendReminders } from '@/bot/reports';
import { createCardPurchase } from '@/server/card-purchases';
import { createCard } from '@/server/cards';
import { createTemplate, generateOccurrences } from '@/server/recurring';
import { freshDb } from './helpers';

const EDUARDO_TG = 1001;
const VIVIANE_TG = 1002;
const STRANGER_TG = 9999;

let pg: PGlite;
let db: AnyDB;
let mercado: string;
let nubank: string;
let nextParse: ParsedEntry | Error;
let calls: { method: string; payload: Record<string, unknown> }[];
let bot: ReturnType<typeof createBot>;
let updateId = 1;
let now = new Date();

const q = async <T>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;

const parsed = (over: Partial<Extract<ParsedEntry, { ok: true }>> = {}): ParsedEntry => ({
  ok: true,
  kind: 'EXPENSE',
  amountCents: 18_000,
  amountError: null,
  description: 'Mercado',
  categoryId: mercado,
  paymentMethod: 'PIX',
  cardId: null,
  installments: null,
  date: '2026-10-17',
  beneficiaryUserId: null,
  confidence: 95,
  ...over,
});

const from = (id: number) => ({ id, is_bot: false, first_name: 'X' });
const chat = (id: number) => ({ id, type: 'private' as const, first_name: 'X' });

async function sendText(fromId: number, text: string, id = updateId++) {
  calls = [];
  const update = {
    update_id: id,
    message: { message_id: id, date: 0, chat: chat(fromId), from: from(fromId), text },
  };
  await bot.handleUpdate(update as unknown as Update);
  return calls;
}

async function tap(fromId: number, data: string) {
  calls = [];
  const id = updateId++;
  const update = {
    update_id: id,
    callback_query: {
      id: String(id),
      from: from(fromId),
      chat_instance: 'ci',
      data,
      message: { message_id: 1, date: 0, chat: chat(fromId), text: 'x' },
    },
  };
  await bot.handleUpdate(update as unknown as Update);
  return calls;
}

const sent = (cs: typeof calls) => cs.filter((c) => c.method === 'sendMessage');
const lastText = (cs: typeof calls) => String(sent(cs).at(-1)?.payload.text ?? '');
const buttons = (cs: typeof calls) =>
  (
    (sent(cs).at(-1)?.payload.reply_markup as { inline_keyboard?: { callback_data: string }[][] })
      ?.inline_keyboard ?? []
  )
    .flat()
    .map((b) => b.callback_data);
const txCount = async () =>
  (
    await q<{ n: number }>(
      `select count(*)::int n from transactions where source = 'BOT' and deleted_at is null`,
    )
  )[0]!.n;

beforeEach(async () => {
  ({ pg, db } = await freshDb());
  await seed(
    db,
    seedConfigFromEnv({
      SEED_USER1_NAME: 'Eduardo',
      SEED_USER1_EMAIL: 'eduardo@example.com',
      SEED_USER1_PASSWORD: 'senha-do-eduardo',
      SEED_USER1_TELEGRAM_ID: String(EDUARDO_TG),
      SEED_USER2_NAME: 'Viviane',
      SEED_USER2_EMAIL: 'viviane@example.com',
      SEED_USER2_PASSWORD: 'senha-da-viviane',
      SEED_USER2_TELEGRAM_ID: String(VIVIANE_TG),
      SEED_OPENING_BALANCE: '5.000,00',
      SEED_OPENING_BALANCE_DATE: '2026-10-01',
    }),
  );
  mercado = (await q<{ id: string }>(`select id from categories where name = 'Mercado'`))[0]!.id;
  const eduardoId = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  nubank = (
    await createCard(
      { db, userId: eduardoId, today: '2026-10-17' },
      {
        name: 'Nubank Eduardo',
        issuer: 'Nubank',
        last4: null,
        isAdditional: false,
        holderName: null,
        limitTotal: 500_000,
        closingDay: 3,
        dueDay: 10,
        botAliases: ['nubank'],
      },
    )
  ).id;
  nextParse = parsed();
  now = new Date(); // created_at vem do relógio real do banco
  bot = createBot(
    '123:TEST',
    {
      db,
      parser: async () => {
        if (nextParse instanceof Error) throw nextParse;
        return nextParse;
      },
      today: () => '2026-10-17',
      now: () => now,
    },
    {
      botInfo: { id: 1, is_bot: true, first_name: 'Finah', username: 'finah_bot' } as UserFromGetMe,
    },
  );
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result =
      method === 'sendMessage' ? { message_id: 1, date: 0, chat: { id: 1, type: 'private' } } : true;
    return { ok: true, result } as never;
  });
});

describe('bot do Telegram', () => {
  it('ignora quem não está na whitelist, sem responder nem gravar', async () => {
    expect(await sendText(STRANGER_TG, 'mercado 180 pix')).toEqual([]);
    expect((await q(`select 1 from bot_messages`)).length).toBe(0);
  });

  it('confiança alta: lança na hora, mostra o saldo e oferece Desfazer', async () => {
    const cs = await sendText(EDUARDO_TG, 'mercado 180 no pix');
    expect(lastText(cs)).toContain('✅ Lançado');
    expect(lastText(cs)).toMatch(/Mercado — R\$\s180,00/);
    expect(lastText(cs)).toMatch(/Saldo da conta: R\$\s4\.820,00/);
    expect(buttons(cs)[0]).toMatch(/^u:/);
    const [tx] = await q<{ amount: string; source: string; name: string; method: string }>(
      `select t.amount_cents::text amount, t.source, u.name, t.payment_method method
       from transactions t join users u on u.id = t.created_by_user_id`,
    );
    expect(tx).toEqual({ amount: '18000', source: 'BOT', name: 'Eduardo', method: 'PIX' });
  });

  it('idempotente: o mesmo update_id reenviado não lança de novo', async () => {
    await sendText(EDUARDO_TG, 'mercado 180 no pix', 500);
    expect(await sendText(EDUARDO_TG, 'mercado 180 no pix', 500)).toEqual([]);
    expect(await txCount()).toBe(1);
  });

  it('confiança baixa: nada é salvo até confirmar; toque duplo não duplica', async () => {
    nextParse = parsed({ confidence: 40 });
    const cs = await sendText(EDUARDO_TG, 'mercado 180');
    expect(lastText(cs)).toContain('Confere?');
    const [confirm, cancel] = buttons(cs);
    expect(confirm).toMatch(/^c:/);
    expect(cancel).toMatch(/^x:/);
    expect(await txCount()).toBe(0);

    expect(lastText(await tap(VIVIANE_TG, confirm!))).toContain('Só quem enviou');
    expect(lastText(await tap(EDUARDO_TG, confirm!))).toContain('✅ Lançado');
    expect(lastText(await tap(EDUARDO_TG, confirm!))).toContain('Já está lançado');
    expect(await txCount()).toBe(1);
  });

  it('cancelar não lança nada', async () => {
    nextParse = parsed({ paymentMethod: null });
    const [, cancel] = buttons(await sendText(EDUARDO_TG, 'mercado 180'));
    expect(lastText(await tap(EDUARDO_TG, cancel!))).toContain('Cancelado');
    expect(await txCount()).toBe(0);
  });

  it('sem categoria: usa "A classificar" e pede confirmação', async () => {
    nextParse = parsed({ categoryId: null });
    const cs = await sendText(EDUARDO_TG, 'coisa 50 pix');
    expect(lastText(cs)).toContain('A classificar');
    expect(buttons(cs)[0]).toMatch(/^c:/);
  });

  it('Desfazer: só quem lançou, até 24h, e o saldo volta', async () => {
    const [undo] = buttons(await sendText(EDUARDO_TG, 'mercado 180 no pix'));
    expect(lastText(await tap(VIVIANE_TG, undo!))).toContain('Só quem lançou');
    expect(lastText(await tap(EDUARDO_TG, undo!))).toMatch(/Desfeito[\s\S]*R\$\s5\.000,00/);
    expect(await txCount()).toBe(0);
    expect(lastText(await tap(EDUARDO_TG, undo!))).toContain('já foi desfeito');
  });

  it('/desfazer desfaz o último do próprio usuário; depois de 24h, não', async () => {
    await sendText(EDUARDO_TG, 'mercado 180 no pix');
    expect(lastText(await sendText(VIVIANE_TG, '/desfazer'))).toContain('Nenhum lançamento seu');
    expect(lastText(await sendText(EDUARDO_TG, '/desfazer'))).toContain('Desfeito');

    await sendText(EDUARDO_TG, 'mercado 180 no pix');
    await q("update bot_messages set created_at = created_at - interval '25 hours'");
    await q("update transactions set created_at = created_at - interval '25 hours'");
    expect(lastText(await sendText(EDUARDO_TG, '/desfazer'))).toContain('Nenhum lançamento seu');
  });

  it('compra parcelada no cartão: plano + parcelas, fatura e limite na resposta', async () => {
    nextParse = parsed({
      paymentMethod: 'CREDIT_CARD',
      cardId: nubank,
      installments: 3,
      amountCents: 10_000,
      description: 'Tênis',
    });
    const cs = await sendText(EDUARDO_TG, 'tênis 100 no nubank em 3x');
    const text = lastText(cs);
    expect(text).toContain('✅ Lançado');
    expect(text).toMatch(/💳 Tênis — R\$\s100,00/);
    expect(text).toMatch(/3x \(1ª R\$\s33,34 \+ 2× R\$\s33,33\)/);
    expect(text).toContain('1ª parcela na fatura de novembro de 2026 (vence 10/11)');
    expect(text).toMatch(/Limite disponível no Nubank Eduardo: R\$\s4\.900,00/);
    const items = await q<{ n: number; amount: string }>(
      `select installment_number n, amount_cents::text amount from invoice_items order by 1`,
    );
    expect(items).toEqual([
      { n: 1, amount: '3334' },
      { n: 2, amount: '3333' },
      { n: 3, amount: '3333' },
    ]);
    // desfazer a compra devolve o limite
    expect(lastText(await tap(EDUARDO_TG, buttons(cs)[0]!))).toMatch(/Desfeito[\s\S]*R\$\s5\.000,00/);
    expect(await txCount()).toBe(0);
  });

  it('cartão sem saber qual: pergunta e não lança', async () => {
    nextParse = parsed({ paymentMethod: 'CREDIT_CARD', cardId: null });
    expect(lastText(await sendText(EDUARDO_TG, 'mercado 180 no crédito'))).toContain('Em qual cartão?');
    expect(await txCount()).toBe(0);
  });

  it('cartão com confiança baixa: confirma e lança no cartão', async () => {
    nextParse = parsed({ paymentMethod: 'CREDIT_CARD', cardId: nubank, confidence: 50 });
    const cs = await sendText(EDUARDO_TG, 'mercado 180 nubank');
    expect(lastText(cs)).toContain('Confere?');
    expect(lastText(cs)).toContain('Nubank Eduardo · à vista');
    expect(lastText(await tap(EDUARDO_TG, buttons(cs)[0]!))).toContain('Fatura de novembro de 2026');
    expect((await q(`select 1 from installment_plans`)).length).toBe(1);
  });

  it('receitas ficam para depois (nada é lançado)', async () => {
    nextParse = parsed({ kind: 'INCOME' });
    expect(lastText(await sendText(EDUARDO_TG, 'recebi 5000'))).toContain('só lança despesas');
    expect(await txCount()).toBe(0);
  });

  it('data antes do início do controle: recusa com a mensagem do app', async () => {
    nextParse = parsed({ date: '2026-09-20' });
    expect(lastText(await sendText(EDUARDO_TG, 'mercado 180 pix dia 20/09'))).toContain('início do controle');
    expect(await txCount()).toBe(0);
  });

  it('LLM indisponível: resposta amigável e registro FAILED', async () => {
    nextParse = new ParserUnavailableError('sem chave');
    expect(lastText(await sendText(EDUARDO_TG, 'mercado 180'))).toContain('Não consegui entender agora');
    const [m] = await q<{ status: string }>(`select status from bot_messages`);
    expect(m!.status).toBe('FAILED');
  });

  it('valor ilegível: pede de novo, sem chutar', async () => {
    nextParse = parsed({ amountCents: null, amountError: 'Valor inválido. Use o formato 1.234,56.' });
    expect(lastText(await sendText(EDUARDO_TG, 'mercado 12,345'))).toContain('Valor inválido');
    expect(await txCount()).toBe(0);
  });
});

describe('consultas e lembretes (Fase 4)', () => {
  /** o Intl separa "R$" do valor com espaço não separável */
  const n = (v: string | null) => (v ?? '').replace(/ /g, ' ');
  const ctxOf = async () => ({
    db,
    userId: (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id,
    today: '2026-10-17',
  });
  const addBill = async (day: number) => {
    const ctx = await ctxOf();
    await createTemplate(ctx, {
      type: 'FIXED',
      direction: 'EXPENSE',
      description: 'Luz',
      categoryId: mercado,
      amount: 25_000,
      dayOfMonth: day,
      paymentMethod: 'PIX',
      creditCardId: null,
      startMonth: '2026-10-01',
      endMonth: null,
      beneficiaryUserId: null,
    });
    await generateOccurrences(db, '2026-10-17');
  };

  it('/saldo mostra o saldo atual e o previsto para o fim do mês', async () => {
    await addBill(25);
    const text = n(lastText(await sendText(EDUARDO_TG, '/saldo')));
    expect(text).toContain('Saldo atual: R$ 5.000,00');
    expect(text).toContain('Previsto para o fim do mês: R$ 4.750,00');
  });

  it('/fatura mostra a fatura aberta e o limite; /pendentes lista as contas do mês', async () => {
    await createCardPurchase(await ctxOf(), {
      cardId: nubank,
      amount: 12_345,
      installments: 1,
      description: 'Farmácia',
      categoryId: mercado,
      date: '2026-10-17',
      beneficiaryUserId: null,
      notes: null,
    });
    const fatura = n(lastText(await sendText(EDUARDO_TG, '/fatura')));
    expect(fatura).toContain('Nubank Eduardo');
    expect(fatura).toContain('Fatura de novembro de 2026 (aberta): R$ 123,45');
    expect(fatura).toContain('Limite disponível: R$ 4.876,55');

    expect(n(lastText(await sendText(EDUARDO_TG, '/pendentes')))).toContain('Nada pendente');
    await addBill(17);
    const pend = n(lastText(await sendText(VIVIANE_TG, '/pendentes')));
    expect(pend).toContain('17/10/2026 Luz: pagar R$ 250,00 · vence hoje');
  });

  it('lembrete das 9h: conta que vence hoje e fatura que vence em 2 dias; sem nada, nenhuma mensagem', async () => {
    const sentTo: number[] = [];
    const send = async (chatId: number) => {
      sentTo.push(chatId);
    };
    expect(await sendReminders(db, '2026-10-17', send)).toBe(0);

    await addBill(17);
    expect(n(await reminderText(db, '2026-10-17'))).toContain('• Luz: pagar R$ 250,00');
    expect(await sendReminders(db, '2026-10-17', send)).toBe(2);
    expect(sentTo.sort()).toEqual([EDUARDO_TG, VIVIANE_TG]);

    await createCardPurchase(await ctxOf(), {
      cardId: nubank,
      amount: 10_000,
      installments: 1,
      description: 'Livro',
      categoryId: mercado,
      date: '2026-10-17',
      beneficiaryUserId: null,
      notes: null,
    });
    // fatura de novembro: fecha 03/11, vence 10/11 → lembrete em 08/11
    const nov = n(await reminderText(db, '2026-11-08'));
    expect(nov).toContain('Faturas que vencem em 10/11/2026:');
    expect(nov).toContain('• Nubank Eduardo: falta pagar R$ 100,00');
    expect(n(await reminderText(db, '2026-11-07'))).not.toContain('Faturas');
  });
});
