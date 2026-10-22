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

const parsed = (
  over: Partial<Extract<ParsedEntry, { ok: true; kind: 'EXPENSE' | 'INCOME' }>> = {},
): ParsedEntry => ({
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
    const [confirm, , cancel] = buttons(cs);
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
    const [, , cancel] = buttons(await sendText(EDUARDO_TG, 'mercado 180'));
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

describe('corrigir (Fase 5)', () => {
  const labeled = (cs: typeof calls) =>
    (
      (
        sent(cs).at(-1)?.payload.reply_markup as {
          inline_keyboard?: { text: string; callback_data: string }[][];
        }
      )?.inline_keyboard ?? []
    )
      .flat()
      .map((b) => ({ text: b.text, data: b.callback_data }));
  const pick = (cs: typeof calls, text: string) => labeled(cs).find((b) => b.text === text)!.data;
  const byPrefix = (cs: typeof calls, prefix: string) => buttons(cs).find((d) => d.startsWith(prefix))!;
  const lastTx = async () =>
    (
      await q<{ category: string; beneficiary: string | null; version: number }>(
        `select c.name category, u.name beneficiary, t.version
         from transactions t join categories c on c.id = t.category_id left join users u on u.id = t.beneficiary_user_id
         where t.source = 'BOT' and t.deleted_at is null order by t.created_at desc limit 1`,
      )
    )[0]!;

  it('o resumo de confirmação tem Confirmar, Corrigir e Cancelar', async () => {
    nextParse = parsed({ confidence: 40 });
    const cs = await sendText(EDUARDO_TG, 'mercado 180');
    expect(buttons(cs).map((d) => d.split(':')[0])).toEqual(['c', 'e', 'x']);
    expect(lastText(await tap(EDUARDO_TG, byPrefix(cs, 'e:')))).toContain('O que corrigir?');
  });

  it('antes de confirmar: troca a categoria e de quem é; nada é salvo até Confirmar', async () => {
    nextParse = parsed({ confidence: 40 });
    const cs = await sendText(EDUARDO_TG, 'mercado 180');
    const menu = await tap(EDUARDO_TG, byPrefix(cs, 'e:'));
    expect(labeled(menu).map((b) => b.text)).toEqual(['🏷️ Categoria', '👥 De quem é']);

    const cats = await tap(EDUARDO_TG, pick(menu, '🏷️ Categoria'));
    expect(labeled(cats).map((b) => b.text)).toContain('Lazer');
    expect(labeled(cats).map((b) => b.text)).not.toContain('Salário CLT'); // só categorias de despesa
    const afterCat = await tap(EDUARDO_TG, pick(cats, 'Lazer'));
    expect(lastText(afterCat)).toContain('Confere?');
    expect(lastText(afterCat)).toContain('Lazer');
    expect(buttons(afterCat).map((d) => d.split(':')[0])).toEqual(['c', 'e', 'x']);

    const people = await tap(
      EDUARDO_TG,
      pick(await tap(EDUARDO_TG, byPrefix(afterCat, 'e:')), '👥 De quem é'),
    );
    expect(labeled(people).map((b) => b.text)).toEqual(['👫 Casal', 'Eduardo', 'Viviane']);
    const afterBen = await tap(EDUARDO_TG, pick(people, 'Viviane'));
    expect(lastText(afterBen)).toContain('De quem: Viviane');
    expect(await txCount()).toBe(0);

    expect(lastText(await tap(EDUARDO_TG, byPrefix(afterBen, 'c:')))).toContain('✅ Lançado');
    expect(await lastTx()).toMatchObject({ category: 'Lazer', beneficiary: 'Viviane' });
  });

  it('depois de lançado: corrige a categoria e o beneficiário do lançamento (edita, com versão e auditoria)', async () => {
    const cs = await sendText(EDUARDO_TG, 'mercado 180 no pix');
    expect(buttons(cs).map((d) => d.split(':')[0])).toEqual(['u', 'e']);
    expect(await lastTx()).toMatchObject({ category: 'Mercado', beneficiary: null, version: 1 });

    const cats = await tap(EDUARDO_TG, pick(await tap(EDUARDO_TG, byPrefix(cs, 'e:')), '🏷️ Categoria'));
    const fixed = await tap(EDUARDO_TG, pick(cats, 'Alimentação fora'));
    expect(lastText(fixed)).toContain('✏️ Corrigido');
    expect(lastText(fixed)).toContain('Alimentação fora');
    expect(buttons(fixed).map((d) => d.split(':')[0])).toEqual(['u', 'e']); // continua dando para desfazer/corrigir

    const people = await tap(EDUARDO_TG, pick(await tap(EDUARDO_TG, byPrefix(fixed, 'e:')), '👥 De quem é'));
    await tap(EDUARDO_TG, pick(people, 'Eduardo'));
    expect(await lastTx()).toMatchObject({
      category: 'Alimentação fora',
      beneficiary: 'Eduardo',
      version: 3,
    });
    expect(await txCount()).toBe(1); // editou, não criou outro
    expect(
      (await q(`select 1 from audit_log where entity = 'transactions' and action = 'UPDATE'`)).length,
    ).toBe(2);

    // voltar para casal
    const people2 = await tap(EDUARDO_TG, pick(await tap(EDUARDO_TG, byPrefix(fixed, 'e:')), '👥 De quem é'));
    const back = await tap(EDUARDO_TG, pick(people2, '👫 Casal'));
    expect(lastText(back)).toContain('De quem: casal');
    expect((await lastTx()).beneficiary).toBeNull();
  });

  it('compra no cartão: corrige a categoria da compra', async () => {
    nextParse = parsed({ paymentMethod: 'CREDIT_CARD', cardId: nubank, confidence: 95 });
    const cs = await sendText(EDUARDO_TG, 'mercado 180 nubank');
    const cats = await tap(EDUARDO_TG, pick(await tap(EDUARDO_TG, byPrefix(cs, 'e:')), '🏷️ Categoria'));
    expect(lastText(await tap(EDUARDO_TG, pick(cats, 'Lazer')))).toContain('✏️ Corrigido');
    expect((await lastTx()).category).toBe('Lazer');
  });

  it('só quem lançou corrige, e depois de 24h só pelo app', async () => {
    const cs = await sendText(EDUARDO_TG, 'mercado 180 no pix');
    expect(lastText(await tap(VIVIANE_TG, byPrefix(cs, 'e:')))).toContain('Só quem enviou');
    const cats = await tap(EDUARDO_TG, pick(await tap(EDUARDO_TG, byPrefix(cs, 'e:')), '🏷️ Categoria'));
    const lazer = pick(cats, 'Lazer');
    expect(lastText(await tap(VIVIANE_TG, lazer))).toContain('Só quem enviou');
    expect((await lastTx()).category).toBe('Mercado');

    await q("update transactions set created_at = created_at - interval '25 hours'");
    expect(lastText(await tap(EDUARDO_TG, lazer))).toContain('Passou de 24h');
    expect((await lastTx()).category).toBe('Mercado');
  });

  it('desfeito ou cancelado não dá mais para corrigir; opção inválida é recusada', async () => {
    const cs = await sendText(EDUARDO_TG, 'mercado 180 no pix');
    await tap(EDUARDO_TG, byPrefix(cs, 'u:'));
    expect(lastText(await tap(EDUARDO_TG, byPrefix(cs, 'e:')))).toContain('já foi encerrado');
    const id = byPrefix(cs, 'e:').slice(2);
    expect(lastText(await tap(EDUARDO_TG, `k:${id}:zzzzzzzz`))).toContain('Opção inválida');
  });
});

describe('receitas e consultas (Fase 6)', () => {
  /** o Intl separa "R$" do valor com espaço não separável */
  const n = (v: string | null) => (v ?? '').replace(/ /g, ' ');
  const reply = async (text: string) => n(lastText(await sendText(EDUARDO_TG, text)));
  const ctxOf = async () => ({
    db,
    userId: (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id,
    today: '2026-10-17',
  });
  const catId = async (name: string) =>
    (await q<{ id: string }>(`select id from categories where name = $1`, [name]))[0]!.id;
  const query = (query: Extract<ParsedEntry, { kind: 'QUERY' }>['query']): ParsedEntry => ({
    ok: true,
    kind: 'QUERY',
    query,
  });
  type Entry = Extract<ParsedEntry, { ok: true; kind: 'EXPENSE' | 'INCOME' }>;
  const income = (over: Partial<Entry> = {}) =>
    parsed({ kind: 'INCOME', description: 'Salário', amountCents: 500_000, paymentMethod: null, ...over });
  const buyOnCard = async (amount: number, description: string, installments = 1, date = '2026-10-17') =>
    createCardPurchase(await ctxOf(), {
      cardId: nubank,
      amount,
      installments,
      description,
      categoryId: mercado,
      date,
      beneficiaryUserId: null,
      notes: null,
    });

  describe('receitas', () => {
    it('lança a receita na hora (categoria e valor certos), soma ao saldo e dá para desfazer', async () => {
      nextParse = income({ categoryId: await catId('Salário CLT') });
      const cs = await sendText(EDUARDO_TG, 'recebi 5000 de salário');
      expect(n(lastText(cs))).toContain('✅ Lançado');
      expect(n(lastText(cs))).toContain('💰 Salário — R$ 5.000,00');
      expect(n(lastText(cs))).toContain('Saldo da conta: R$ 10.000,00');
      const [t] = await q<{ kind: string; category: string; method: string; source: string }>(
        `select t.kind::text kind, c.name category, t.payment_method::text method, t.source::text source
         from transactions t join categories c on c.id = t.category_id where t.source = 'BOT'`,
      );
      // forma de recebimento não dita: "Outro" (não chutamos Pix)
      expect(t).toEqual({ kind: 'INCOME', category: 'Salário CLT', method: 'OTHER', source: 'BOT' });

      expect(n(lastText(await tap(EDUARDO_TG, buttons(cs)[0]!)))).toMatch(/Desfeito[\s\S]*R\$\s5\.000,00/);
      expect(await txCount()).toBe(0);
    });

    it('sem categoria: usa "Outras receitas" e pede confirmação; confirmar lança', async () => {
      nextParse = income({ categoryId: null });
      const cs = await sendText(EDUARDO_TG, 'caiu 5000');
      expect(n(lastText(cs))).toContain('Confere?');
      expect(n(lastText(cs))).toContain('Outras receitas');
      expect(await txCount()).toBe(0);
      expect(n(lastText(await tap(EDUARDO_TG, buttons(cs)[0]!)))).toContain('✅ Lançado');
      expect(
        (
          await q<{ c: string }>(
            `select c.name c from transactions t join categories c on c.id = t.category_id where t.source = 'BOT'`,
          )
        )[0]!.c,
      ).toBe('Outras receitas');
    });

    it('receita no cartão não existe: recusa e explica', async () => {
      nextParse = income({
        categoryId: await catId('Renda extra'),
        paymentMethod: 'CREDIT_CARD',
        cardId: nubank,
      });
      expect(await reply('recebi 100 no cartão')).toContain('Receita não entra no cartão');
      expect(await txCount()).toBe(0);
    });

    it('com a forma dita (pix) e de quem é, respeita; ✏️ Corrigir oferece só categorias de RECEITA', async () => {
      nextParse = income({
        categoryId: await catId('Renda PJ'),
        paymentMethod: 'PIX',
        beneficiaryUserId: (await q<{ id: string }>(`select id from users where name = 'Viviane'`))[0]!.id,
      });
      const cs = await sendText(EDUARDO_TG, 'recebi 5000 da pj pix pra viviane');
      expect(n(lastText(cs))).toContain('De quem: Viviane');
      const menu = await tap(
        EDUARDO_TG,
        buttons(cs).find((d) => d.startsWith('e:'))!,
      );
      const cats = await tap(
        EDUARDO_TG,
        buttons(menu).find((d) => d.startsWith('kc:'))!,
      );
      const markup = sent(cats).at(-1)!.payload.reply_markup as {
        inline_keyboard: { text: string; callback_data: string }[][];
      };
      const labels = markup.inline_keyboard.flat().map((b) => b.text);
      expect(labels).toContain('Renda PJ');
      expect(labels).toContain('Salário CLT');
      expect(labels).not.toContain('Mercado');
      const pick = markup.inline_keyboard.flat().find((b) => b.text === 'Salário CLT')!.callback_data;
      expect(n(lastText(await tap(EDUARDO_TG, pick)))).toContain('Salário CLT');
      expect(
        (
          await q<{ c: string; m: string }>(
            `select c.name c, t.payment_method::text m from transactions t join categories c on c.id = t.category_id where t.source = 'BOT'`,
          )
        )[0],
      ).toEqual({ c: 'Salário CLT', m: 'PIX' });
    });
  });

  describe('consultas em linguagem natural', () => {
    it('limite: do cartão citado, com uso e disponível; cartão adicional sem limite mostra o comprometido', async () => {
      await buyOnCard(12_345, 'Farmácia');
      nextParse = query({ type: 'LIMIT', cardId: nubank });
      const t = await reply('quanto tenho de limite no nubank?');
      expect(t).toContain('💳 Nubank Eduardo');
      expect(t).toContain('Limite: R$ 5.000,00 · em uso: R$ 123,45 (2%)');
      expect(t).toContain('Disponível: R$ 4.876,55');
      expect(t).toContain('Fatura aberta de novembro de 2026: R$ 123,45');
      expect(await txCount()).toBe(0); // pergunta nunca lança nada
    });

    it('pendentes: sem mês = este mês (com atrasados); com mês = só o que vence nele, inclusive faturas', async () => {
      await buyOnCard(12_345, 'Farmácia'); // cai na fatura de novembro (vence 10/11)
      const ctx = await ctxOf();
      await createTemplate(ctx, {
        type: 'FIXED',
        direction: 'EXPENSE',
        description: 'Luz',
        categoryId: mercado,
        amount: 25_000,
        dayOfMonth: 25,
        paymentMethod: 'PIX',
        creditCardId: null,
        startMonth: '2026-10-01',
        endMonth: null,
        beneficiaryUserId: null,
      });
      await generateOccurrences(db, '2026-10-17');

      nextParse = query({ type: 'PENDING', month: null });
      const out = await reply('o que falta pagar esse mês?');
      expect(out).toContain('Pendentes até o fim de outubro de 2026');
      expect(out).toContain('25/10 Luz: pagar R$ 250,00');
      expect(out).not.toContain('Fatura Nubank'); // a fatura só vence em novembro
      expect(out).toContain('A pagar: R$ 250,00');

      nextParse = query({ type: 'PENDING', month: '2026-11-01' });
      const nov = await reply('o que vence em novembro?');
      expect(nov).toContain('Pendentes de novembro de 2026');
      expect(nov).toContain('10/11 Fatura Nubank Eduardo (novembro de 2026): pagar R$ 123,45');
      expect(nov).not.toContain('Luz');

      nextParse = query({ type: 'PENDING', month: '2026-12-01' });
      expect(await reply('e dezembro?')).toContain('Nada pendente em dezembro de 2026');
    });

    it('resumo da fatura: total, datas, maiores compras, por categoria; mês sem fatura avisa', async () => {
      await buyOnCard(12_345, 'Farmácia');
      await buyOnCard(30_000, 'Tênis', 3);
      nextParse = query({ type: 'INVOICE', cardId: nubank, month: null });
      const t = await reply('resumo da fatura do nubank');
      expect(t).toContain('💳 Nubank Eduardo · fatura de novembro de 2026 (aberta)');
      expect(t).toContain('Total: R$ 223,45'); // 123,45 + 1ª parcela de 100,00
      expect(t).toContain('Fecha 03/11/2026 · vence 10/11/2026');
      expect(t).toContain('2 lançamentos. Maiores:');
      expect(t).toContain('• Farmácia — R$ 123,45');
      expect(t).toContain('• Tênis (1/3) — R$ 100,00');
      expect(t).toContain('Limite disponível:');

      nextParse = query({ type: 'INVOICE', cardId: nubank, month: '2026-03-01' });
      expect(await reply('fatura de março')).toContain(
        'Não achei a fatura de março de 2026 do Nubank Eduardo',
      );
    });

    it('gastos do mês e de uma categoria: Bruto e Mensal, por categoria', async () => {
      await sendText(EDUARDO_TG, 'mercado 180 no pix'); // R$ 180,00 em Mercado
      await buyOnCard(12_345, 'Farmácia');
      nextParse = query({ type: 'SPENDING', month: null, categoryId: null });
      const t = await reply('quanto gastei esse mês?');
      expect(t).toContain('Gastos de outubro de 2026');
      expect(t).toContain('Compras do mês (Bruto): R$ 303,45');
      expect(t).toContain('Sai da conta no mês (Mensal): R$ 180,00'); // a fatura só sai em novembro
      expect(t).toContain('• Mercado — R$ 303,45');

      nextParse = query({ type: 'SPENDING', month: null, categoryId: mercado });
      expect(await reply('quanto gastei com mercado?')).toContain('Mercado em outubro de 2026');
    });

    it('resumo do mês e últimos lançamentos', async () => {
      await sendText(EDUARDO_TG, 'mercado 180 no pix');
      nextParse = income({ categoryId: await catId('Salário CLT') });
      await sendText(EDUARDO_TG, 'recebi 5000 de salário');
      nextParse = query({ type: 'MONTH_SUMMARY', month: null });
      const r = await reply('como está o mês?');
      expect(r).toContain('Resumo de outubro de 2026');
      expect(r).toContain('Entrou: R$ 5.000,00 · saiu: R$ 180,00');
      expect(r).toContain('Saldo previsto no fim do mês: R$ 9.820,00');

      nextParse = query({ type: 'RECENT' });
      const rec = await reply('o que lancei por último?');
      expect(rec).toContain('Últimos lançamentos:');
      expect(rec).toMatch(/• 17\/10 Salário — \+ R\$ 5\.000,00 \(Salário CLT · Outro\)/);
      expect(rec).toMatch(/• 17\/10 Mercado — R\$ 180,00 \(Mercado · Pix\)/);
    });

    it('conversa que não é lançamento nem pergunta: orienta, sem lançar', async () => {
      nextParse = { ok: false, reason: 'not_entry' };
      const t = await reply('bom dia!');
      expect(t).toContain('Mande um gasto, uma receita ou uma pergunta');
      expect(t).toContain('/limite');
    });
  });

  describe('comandos com mês e cartão', () => {
    it('/pendentes, /gastos e /resumo aceitam o mês; padrão é o mês atual; mês inválido é recusado', async () => {
      await buyOnCard(12_345, 'Farmácia');
      expect(await reply('/pendentes')).toContain('Nada pendente');
      expect(await reply('/pendentes novembro')).toContain(
        '10/11 Fatura Nubank Eduardo (novembro de 2026): pagar R$ 123,45',
      );
      expect(await reply('/pendentes próximo')).toContain('Pendentes de novembro de 2026');
      expect(await reply('/pendentes 11/2026')).toContain('Pendentes de novembro de 2026');
      expect(await reply('/pendentes banana')).toContain('Não entendi o mês');
      expect(await reply('/gastos')).toContain('Gastos de outubro de 2026');
      expect(await reply('/gastos passado')).toContain('Gastos de setembro de 2026');
      expect(await reply('/resumo dezembro')).toContain('Resumo de dezembro de 2026');
    });

    it('/limite e /fatura aceitam o cartão pelo nome ou apelido; /fatura sem nada = o único cartão', async () => {
      await buyOnCard(12_345, 'Farmácia');
      expect(await reply('/limite')).toContain('Limite: R$ 5.000,00');
      expect(await reply('/limite nubank')).toContain('💳 Nubank Eduardo');
      expect(await reply('/limite xpto')).toContain('Não achei esse cartão. Cartões: Nubank Eduardo');
      expect(await reply('/fatura nubank')).toContain('fatura de novembro de 2026 (aberta)');
      expect(await reply('/fatura nubank novembro')).toContain('fatura de novembro de 2026');
      expect(await reply('/fatura nubank março')).toContain('Não achei a fatura de março');
      expect(await reply('/fatura')).toContain('Total: R$ 123,45');
    });

    it('com dois cartões: /fatura sem cartão mostra a visão geral; com mês pede o cartão', async () => {
      await createCard(await ctxOf(), {
        name: 'Roxinho',
        issuer: 'Nubank',
        last4: null,
        isAdditional: false,
        holderName: null,
        limitTotal: 100_000,
        closingDay: 5,
        dueDay: 12,
        botAliases: ['roxo'],
      });
      expect(await reply('/fatura')).toContain('Nubank Eduardo');
      expect(await reply('/fatura novembro')).toContain('Qual cartão?');
      expect(await reply('/fatura roxo')).toContain('Roxinho · fatura de');
    });

    it('/ultimos e /resumo funcionam sem lançamentos; só quem está na lista pergunta', async () => {
      expect(await reply('/ultimos')).toContain('Nenhum lançamento ainda');
      expect(await reply('/resumo')).toContain('Resumo de outubro de 2026');
      expect(await sendText(999_999, '/saldo')).toEqual([]);
      expect(await sendText(999_999, '/limite')).toEqual([]);
    });
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
    expect(fatura).toContain('Nubank Eduardo · fatura de novembro de 2026 (aberta)');
    expect(fatura).toContain('Total: R$ 123,45');
    expect(fatura).toContain('Limite disponível: R$ 4.876,55');

    expect(n(lastText(await sendText(EDUARDO_TG, '/pendentes')))).toContain('Nada pendente');
    await addBill(17);
    const pend = n(lastText(await sendText(VIVIANE_TG, '/pendentes')));
    expect(pend).toContain('17/10 Luz: pagar R$ 250,00 · vence hoje');
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
