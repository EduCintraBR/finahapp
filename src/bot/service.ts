/**
 * Lógica do bot, independente do Telegram: recebe dados já extraídos do update e devolve a resposta.
 * O adaptador grammY fica em bot.ts.
 *
 * - Despesa à vista na conta (Fase 2) e compra no cartão, à vista ou parcelada (Fase 3). Só texto.
 * - Só responde aos telegram_user_id cadastrados; outros remetentes são ignorados em silêncio.
 * - Idempotente: update_id único em bot_messages (o Telegram reenvia updates).
 * - Confiança alta → salva e oferece ↩️ Desfazer. Baixa → ✅ Confirmar / ❌ Cancelar, nada salvo antes.
 */
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AnyDB } from '@/db/client';
import { getPrimaryAccount } from '@/db/queries/accounts';
import { getAccountBalance } from '@/db/queries/balance';
import { listActiveCards, listCardSummaries } from '@/db/queries/cards';
import { planIdOfTransaction } from '@/db/queries/entries';
import {
  botMessages,
  categories,
  creditCards,
  installmentPlans,
  invoices,
  transactions,
  users,
} from '@/db/schema';
import { formatDateBR, formatMonthLabel, type ISODate } from '@/domain/dates';
import { formatBRL, splitInstallments } from '@/domain/money';
import { ACCOUNT_PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from '@/lib/labels';
import { createCardPurchase, deleteCardPurchase, updateCardPurchase } from '@/server/card-purchases';
import { type ServiceCtx, UserError } from '@/server/context';
import { createEntry, removeEntry, updateEntry } from '@/server/entries';
import type { CardPurchaseInput, EntryInput } from '@/server/schemas';
import { balanceText, invoicesText, pendingText } from './reports';
import { ParserUnavailableError, type EntryParser, type ParseContext } from './parser';

export type BotDeps = { db: AnyDB; parser: EntryParser; today: () => ISODate; now: () => Date };
export type BotButton = { text: string; data: string };
export type BotReply = {
  text: string;
  buttons?: BotButton[];
  /** botões por linha (padrão 3) */ columns?: number;
};

/** Acima disso (e com categoria e meio/cartão identificados) o bot salva direto (D23). */
export const CONFIDENCE_THRESHOLD = 80;
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
const FALLBACK_CATEGORY = 'A classificar';

const HELP = [
  'Me mande um gasto em uma linha, por exemplo:',
  '• mercado 180 no pix',
  '• uber 23,50 débito',
  '• farmácia 42,90 dinheiro ontem',
  '• tênis 600 no nubank em 3x',
  '',
  'Comandos:',
  '/saldo — saldo atual e previsto para o fim do mês',
  '/fatura — faturas e limite dos cartões',
  '/pendentes — contas a pagar e a receber do mês',
  '/desfazer — desfaz seu último lançamento (até 24h)',
  '',
  'Errou a categoria ou de quem é? Toque em ✏️ Corrigir na resposta (vale até 24h depois de lançar).',
  '',
  'Receitas: pelo app.',
].join('\n');

type Draft = { type: 'ACCOUNT'; input: EntryInput } | { type: 'CARD'; input: CardPurchaseInput };

const accountDraft = z.object({
  kind: z.literal('EXPENSE'),
  amount: z.number().int().positive(),
  description: z.string().min(1).max(200),
  categoryId: z.uuid(),
  paymentMethod: z.enum(ACCOUNT_PAYMENT_METHODS),
  date: z.string(),
  beneficiaryUserId: z.uuid().nullable(),
  notes: z.null(),
});
const cardDraft = z.object({
  cardId: z.uuid(),
  amount: z.number().int().positive(),
  installments: z.number().int().min(1).max(72),
  description: z.string().min(1).max(180),
  categoryId: z.uuid(),
  date: z.string(),
  beneficiaryUserId: z.uuid().nullable(),
  notes: z.null(),
});
/** Rascunho guardado enquanto espera confirmação. Linhas antigas (Fase 2) não têm `type`. */
const pendingPayload = z.preprocess(
  (v) => (v && typeof v === 'object' && !('type' in v) ? { type: 'ACCOUNT', input: v } : v),
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('ACCOUNT'), input: accountDraft }),
    z.object({ type: z.literal('CARD'), input: cardDraft }),
  ]),
);

async function senderOf(db: AnyDB, telegramUserId: number) {
  const [u] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.telegramUserId, telegramUserId));
  return u ?? null;
}

async function parseContext(db: AnyDB, today: ISODate, senderName: string): Promise<ParseContext> {
  const [cats, people, cards] = await Promise.all([
    db
      .select({
        id: categories.id,
        name: categories.name,
        kind: categories.kind,
        botAliases: categories.botAliases,
      })
      .from(categories)
      .where(isNull(categories.archivedAt)),
    db.select({ id: users.id, name: users.name }).from(users),
    listActiveCards(db),
  ]);
  return {
    today,
    senderName,
    categories: cats,
    users: people,
    cards: cards.map((c) => ({ id: c.id, name: c.name, botAliases: c.botAliases })),
  };
}

const installmentsText = (total: number, n: number) => {
  if (n === 1) return 'à vista';
  const [first, ...rest] = splitInstallments(total, n);
  return first === rest[0]
    ? `${n}x de ${formatBRL(first!)}`
    : `${n}x (1ª ${formatBRL(first!)} + ${n - 1}× ${formatBRL(rest[0]!)})`;
};

async function describe(db: AnyDB, d: Draft, today: ISODate): Promise<string> {
  const { input } = d;
  const [[cat], [ben], [card]] = await Promise.all([
    db.select({ name: categories.name }).from(categories).where(eq(categories.id, input.categoryId)),
    input.beneficiaryUserId
      ? db.select({ name: users.name }).from(users).where(eq(users.id, input.beneficiaryUserId))
      : Promise.resolve([undefined]),
    d.type === 'CARD'
      ? db.select({ name: creditCards.name }).from(creditCards).where(eq(creditCards.id, d.input.cardId))
      : Promise.resolve([undefined]),
  ]);
  const when = input.date === today ? 'hoje' : formatDateBR(input.date);
  const how =
    d.type === 'CARD'
      ? `${card?.name ?? 'cartão'} · ${installmentsText(d.input.amount, d.input.installments)}`
      : PAYMENT_METHOD_LABEL[d.input.paymentMethod];
  return [
    `${d.type === 'CARD' ? '💳' : '💸'} ${input.description} — ${formatBRL(input.amount)}`,
    `${cat?.name ?? '?'} · ${how} · ${when}`,
    `De quem: ${ben?.name ?? 'casal'}`,
  ].join('\n');
}

async function balanceLine(db: AnyDB): Promise<string> {
  const account = await getPrimaryAccount(db);
  if (!account) return '';
  return `Saldo da conta: ${formatBRL(await getAccountBalance(db, account.id))}`;
}

/** Limite disponível (ou comprometido, no adicional sem limite) — SPEC §7. */
async function limitLine(db: AnyDB, cardId: string, today: ISODate): Promise<string> {
  const [s] = await listCardSummaries(db, today, { cardId });
  if (!s) return '';
  return s.availableCents === null
    ? `Comprometido no ${s.card.name}: ${formatBRL(s.committedCents)}`
    : `Limite disponível no ${s.card.name}: ${formatBRL(s.availableCents)}`;
}

const setStatus = (db: AnyDB, id: string, values: Partial<typeof botMessages.$inferInsert>) =>
  db.update(botMessages).set(values).where(eq(botMessages.id, id));

export async function handleText(
  deps: BotDeps,
  u: { updateId: number; chatId: number; telegramUserId: number; text: string },
): Promise<BotReply | null> {
  const { db } = deps;
  const sender = await senderOf(db, u.telegramUserId);
  if (!sender) return null; // fora da whitelist: silêncio

  const isCommand = u.text.trim().startsWith('/');
  const [msg] = await db
    .insert(botMessages)
    .values({
      telegramUpdateId: u.updateId,
      telegramChatId: u.chatId,
      userId: sender.id,
      messageType: isCommand ? 'COMMAND' : 'TEXT',
      rawText: u.text.slice(0, 4000),
    })
    .onConflictDoNothing()
    .returning({ id: botMessages.id });
  if (!msg) return null; // update repetido: já processado

  if (isCommand) {
    const command = u.text.trim().split(/\s+/)[0]!.split('@')[0]!.toLowerCase();
    if (command === '/desfazer') return undoLast(deps, sender.id);
    if (command === '/saldo') return { text: await balanceText(db, deps.today()) };
    if (command === '/fatura') return { text: await invoicesText(db, deps.today()) };
    if (command === '/pendentes') return { text: await pendingText(db, deps.today()) };
    return { text: HELP };
  }

  const today = deps.today();
  const context = await parseContext(db, today, sender.name);
  let parsed;
  try {
    parsed = await deps.parser(u.text, context);
  } catch (err) {
    console.error('[bot] parser falhou:', err);
    await setStatus(db, msg.id, {
      status: 'FAILED',
      errorMessage: String(err instanceof Error ? err.message : err),
    });
    return {
      text:
        err instanceof ParserUnavailableError
          ? 'Não consegui entender agora (serviço de leitura indisponível). Tente de novo em instantes ou lance pelo app.'
          : 'Algo deu errado ao ler sua mensagem. Tente de novo ou lance pelo app.',
    };
  }

  const reject = async (text: string) => {
    await setStatus(db, msg.id, { status: 'REJECTED', parsedPayload: parsed });
    return { text };
  };

  if (!parsed.ok) return reject(`Não entendi isso como um gasto.\n\n${HELP}`);
  if (parsed.kind === 'INCOME') return reject('Por enquanto o bot só lança despesas. Receitas: pelo app.');
  if (parsed.amountCents === null) {
    return reject(`${parsed.amountError ?? 'Não encontrei o valor.'} Ex.: "mercado 180 no pix".`);
  }

  let categoryId = parsed.categoryId;
  if (!categoryId) {
    const [fallback] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.name, FALLBACK_CATEGORY), eq(categories.kind, 'EXPENSE')));
    if (!fallback) return reject('Não consegui identificar a categoria. Lance pelo app.');
    categoryId = fallback.id;
  }

  let draft: Draft;
  let identified: boolean;
  if (parsed.paymentMethod === 'CREDIT_CARD') {
    if (context.cards.length === 0)
      return reject('Nenhum cartão cadastrado no app ainda. Cadastre em Cartões.');
    if (!parsed.cardId) {
      return reject(
        `Em qual cartão? Mande de novo dizendo o cartão: ${context.cards.map((c) => c.name).join(', ')}.`,
      );
    }
    const installments = parsed.installments ?? 1;
    if (installments > 72) return reject('Parcelas entre 1 e 72.');
    if (parsed.amountCents < installments) return reject('Cada parcela precisa ter pelo menos R$ 0,01.');
    draft = {
      type: 'CARD',
      input: {
        cardId: parsed.cardId,
        amount: parsed.amountCents,
        installments,
        description: parsed.description.slice(0, 180),
        categoryId,
        date: parsed.date,
        beneficiaryUserId: parsed.beneficiaryUserId,
        notes: null,
      },
    };
    identified = true;
  } else {
    draft = {
      type: 'ACCOUNT',
      input: {
        kind: 'EXPENSE',
        amount: parsed.amountCents,
        description: parsed.description,
        categoryId,
        paymentMethod: parsed.paymentMethod ?? 'PIX',
        date: parsed.date,
        beneficiaryUserId: parsed.beneficiaryUserId,
        notes: null,
      },
    };
    identified = parsed.paymentMethod !== null;
  }

  const confident = parsed.confidence >= CONFIDENCE_THRESHOLD && parsed.categoryId !== null && identified;
  const summary = await describe(db, draft, today);

  if (!confident) {
    await setStatus(db, msg.id, {
      status: 'AWAITING_CONFIRMATION',
      parsedPayload: draft,
      confidence: parsed.confidence,
    });
    return {
      text: `Confere?\n\n${summary}`,
      buttons: confirmButtons(msg.id),
    };
  }
  return saveDraft(deps, msg.id, sender.id, draft, summary, parsed.confidence);
}

async function saveDraft(
  deps: BotDeps,
  botMessageId: string,
  userId: string,
  draft: Draft,
  summary: string,
  confidence: number | null,
): Promise<BotReply> {
  const today = deps.today();
  const ctx: ServiceCtx = { db: deps.db, userId, today };
  try {
    let transactionId: string;
    let footer: string;
    if (draft.type === 'CARD') {
      const r = await createCardPurchase(ctx, draft.input, 'BOT');
      transactionId = r.transactionId;
      const [first] = await deps.db
        .select({ ref: invoices.referenceMonth, due: invoices.dueDate })
        .from(installmentPlans)
        .innerJoin(invoices, eq(invoices.id, installmentPlans.firstInvoiceId))
        .where(eq(installmentPlans.id, r.planId));
      footer = [
        first
          ? `${draft.input.installments > 1 ? '1ª parcela na fatura' : 'Fatura'} de ${formatMonthLabel(first.ref)} (vence ${formatDateBR(first.due).slice(0, 5)})`
          : '',
        await limitLine(deps.db, draft.input.cardId, today),
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      transactionId = (await createEntry(ctx, draft.input, 'BOT')).id;
      footer = await balanceLine(deps.db);
    }
    await setStatus(deps.db, botMessageId, {
      status: 'CREATED',
      transactionId,
      parsedPayload: draft,
      confidence,
    });
    return {
      text: `✅ Lançado\n\n${summary}\n\n${footer}`,
      buttons: savedButtons(botMessageId),
    };
  } catch (err) {
    if (err instanceof UserError) {
      await setStatus(deps.db, botMessageId, { status: 'REJECTED', errorMessage: err.message });
      return { text: `Não lancei: ${err.message}` };
    }
    throw err;
  }
}

const confirmButtons = (id: string): BotButton[] => [
  { text: '✅ Confirmar', data: `c:${id}` },
  { text: '✏️ Corrigir', data: `e:${id}` },
  { text: '❌ Cancelar', data: `x:${id}` },
];

const savedButtons = (id: string): BotButton[] => [
  { text: '↩️ Desfazer', data: `u:${id}` },
  { text: '✏️ Corrigir', data: `e:${id}` },
];

/** O lançamento que a mensagem gerou (ou o rascunho que espera confirmação), se ainda pode ser corrigido. */
async function loadCorrectable(deps: BotDeps, botMessageId: string, userId: string) {
  const [m] = await deps.db
    .select({
      status: botMessages.status,
      payload: botMessages.parsedPayload,
      userId: botMessages.userId,
      transactionId: botMessages.transactionId,
    })
    .from(botMessages)
    .where(eq(botMessages.id, botMessageId));
  if (!m || m.userId !== userId)
    return { ok: false, error: 'Só quem enviou a mensagem pode corrigir.' } as const;
  if (m.status !== 'AWAITING_CONFIRMATION' && m.status !== 'CREATED') {
    return { ok: false, error: 'Esse pedido já foi encerrado.' } as const;
  }
  const draft = pendingPayload.safeParse(m.payload);
  if (!draft.success)
    return { ok: false, error: 'Não consegui recuperar os dados. Mande a mensagem de novo.' } as const;
  return { ok: true, m, draft: draft.data } as const;
}

/** ✏️ Corrigir: o que dá para mudar por botão. Valor, data e meio de pagamento: cancelar/desfazer e mandar de novo. */
async function correctionMenu(
  deps: BotDeps,
  action: 'e' | 'kc' | 'kb',
  botMessageId: string,
  userId: string,
): Promise<BotReply> {
  const c = await loadCorrectable(deps, botMessageId, userId);
  if (!c.ok) return { text: c.error };
  if (action === 'e') {
    const summary = await describe(deps.db, c.draft, deps.today());
    return {
      text: `O que corrigir?\n\n${summary}\n\nPara mudar valor, data ou forma de pagamento, ${c.m.status === 'CREATED' ? 'desfaça' : 'cancele'} e mande de novo.`,
      buttons: [
        { text: '🏷️ Categoria', data: `kc:${botMessageId}` },
        { text: '👥 De quem é', data: `kb:${botMessageId}` },
      ],
      columns: 2,
    };
  }
  if (action === 'kc') {
    const cats = await deps.db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(and(eq(categories.kind, 'EXPENSE'), isNull(categories.archivedAt)))
      .orderBy(asc(categories.name));
    return {
      text: 'Qual é a categoria?',
      buttons: cats.map((k) => ({ text: k.name, data: `k:${botMessageId}:${k.id.slice(0, 8)}` })),
      columns: 2,
    };
  }
  const people = await deps.db
    .select({ id: users.id, name: users.name })
    .from(users)
    .orderBy(asc(users.name));
  return {
    text: 'De quem é o gasto?',
    buttons: [
      { text: '👫 Casal', data: `b:${botMessageId}:c` },
      ...people.map((p) => ({ text: p.name.split(' ')[0]!, data: `b:${botMessageId}:${p.id.slice(0, 8)}` })),
    ],
    columns: 3,
  };
}

/**
 * Aplica a categoria ou o beneficiário escolhido. Rascunho: atualiza e pede a confirmação de novo.
 * Já lançado (até 24h): edita o lançamento (mesmas regras do app) e mostra o resultado.
 */
async function applyCorrection(
  deps: BotDeps,
  action: 'k' | 'b',
  botMessageId: string,
  arg: string,
  userId: string,
): Promise<BotReply> {
  if (!/^(c|[0-9a-f]{8})$/i.test(arg)) return { text: 'Opção inválida.' };
  return deps.db.transaction(async (tx) => {
    const db = tx as unknown as AnyDB;
    const tdeps = { ...deps, db };
    // trava a linha: dois toques seguidos não podem aplicar duas vezes
    await db
      .select({ id: botMessages.id })
      .from(botMessages)
      .where(eq(botMessages.id, botMessageId))
      .for('update');
    const c = await loadCorrectable(tdeps, botMessageId, userId);
    if (!c.ok) return { text: c.error };

    const draft: Draft = structuredClone(c.draft);
    if (action === 'k') {
      const found = await db
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.kind, 'EXPENSE'),
            isNull(categories.archivedAt),
            sql`${categories.id}::text like ${arg.toLowerCase() + '%'}`,
          ),
        );
      if (found.length !== 1) return { text: 'Categoria não encontrada. Toque em ✏️ Corrigir de novo.' };
      draft.input.categoryId = found[0]!.id;
    } else if (arg === 'c') {
      draft.input.beneficiaryUserId = null;
    } else {
      const found = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.id}::text like ${arg.toLowerCase() + '%'}`);
      if (found.length !== 1) return { text: 'Pessoa não encontrada. Toque em ✏️ Corrigir de novo.' };
      draft.input.beneficiaryUserId = found[0]!.id;
    }

    const today = deps.today();
    if (c.m.status === 'AWAITING_CONFIRMATION') {
      await setStatus(db, botMessageId, { parsedPayload: draft });
      return {
        text: `Confere?\n\n${await describe(db, draft, today)}`,
        buttons: confirmButtons(botMessageId),
      };
    }

    // já lançado: edita o lançamento
    if (!c.m.transactionId) return { text: 'Não há lançamento para corrigir aqui.' };
    const [t] = await db
      .select({
        version: transactions.version,
        createdAt: transactions.createdAt,
        deletedAt: transactions.deletedAt,
        creditCardId: transactions.creditCardId,
      })
      .from(transactions)
      .where(eq(transactions.id, c.m.transactionId));
    if (!t || t.deletedAt) return { text: 'Esse lançamento já não existe mais.' };
    if (deps.now().getTime() - t.createdAt.getTime() > UNDO_WINDOW_MS) {
      return { text: 'Passou de 24h: corrija pelo app.' };
    }
    const ctx: ServiceCtx = { db, userId, today };
    try {
      if (draft.type === 'CARD') {
        const planId = await planIdOfTransaction(db, c.m.transactionId);
        if (!planId) return { text: 'Compra não encontrada.' };
        await updateCardPurchase(ctx, planId, {
          description: draft.input.description,
          categoryId: draft.input.categoryId,
          beneficiaryUserId: draft.input.beneficiaryUserId,
          notes: null,
        });
      } else {
        await updateEntry(ctx, c.m.transactionId, t.version, draft.input);
      }
    } catch (err) {
      if (err instanceof UserError) return { text: `Não corrigi: ${err.message}` };
      throw err;
    }
    await setStatus(db, botMessageId, { parsedPayload: draft });
    return {
      text: `✏️ Corrigido\n\n${await describe(db, draft, today)}`,
      buttons: savedButtons(botMessageId),
    };
  });
}

async function undo(deps: BotDeps, botMessageId: string, userId: string): Promise<BotReply> {
  const { db } = deps;
  const [m] = await db
    .select({
      status: botMessages.status,
      transactionId: botMessages.transactionId,
      userId: botMessages.userId,
    })
    .from(botMessages)
    .where(eq(botMessages.id, botMessageId));
  if (!m || m.userId !== userId) return { text: 'Só quem lançou pode desfazer.' };
  if (m.status === 'UNDONE') return { text: 'Esse lançamento já foi desfeito.' };
  if (m.status !== 'CREATED' || !m.transactionId) return { text: 'Não há lançamento para desfazer aqui.' };

  const [t] = await db
    .select({
      version: transactions.version,
      createdAt: transactions.createdAt,
      deletedAt: transactions.deletedAt,
      creditCardId: transactions.creditCardId,
    })
    .from(transactions)
    .where(eq(transactions.id, m.transactionId));
  if (!t || t.deletedAt) return { text: 'Esse lançamento já não existe mais.' };
  if (deps.now().getTime() - t.createdAt.getTime() > UNDO_WINDOW_MS) {
    return { text: 'Passou de 24h: desfaça pelo app.' };
  }
  const ctx: ServiceCtx = { db, userId, today: deps.today() };
  try {
    if (t.creditCardId) {
      const planId = await planIdOfTransaction(db, m.transactionId);
      if (!planId) return { text: 'Compra não encontrada.' };
      await deleteCardPurchase(ctx, planId);
    } else {
      await removeEntry(ctx, m.transactionId, t.version);
    }
  } catch (err) {
    if (err instanceof UserError) return { text: `Não desfiz: ${err.message}` };
    throw err;
  }
  await setStatus(db, botMessageId, { status: 'UNDONE' });
  const footer = t.creditCardId ? await limitLine(db, t.creditCardId, ctx.today) : await balanceLine(db);
  return { text: `↩️ Desfeito.\n\n${footer}` };
}

async function undoLast(deps: BotDeps, userId: string): Promise<BotReply> {
  const since = new Date(deps.now().getTime() - UNDO_WINDOW_MS);
  const [last] = await deps.db
    .select({ id: botMessages.id })
    .from(botMessages)
    .where(
      and(
        eq(botMessages.userId, userId),
        eq(botMessages.status, 'CREATED'),
        gte(botMessages.createdAt, since),
      ),
    )
    .orderBy(desc(botMessages.createdAt))
    .limit(1);
  if (!last) return { text: 'Nenhum lançamento seu pelo bot nas últimas 24h.' };
  return undo(deps, last.id, userId);
}

/**
 * Botões: c:<id> confirmar · x:<id> cancelar · u:<id> desfazer · e:<id> corrigir (menu) ·
 * kc:<id> escolher categoria · kb:<id> escolher de quem é · k:<id>:<8 hex> aplica a categoria ·
 * b:<id>:<c|8 hex> aplica o beneficiário (c = casal).
 */
export async function handleCallback(
  deps: BotDeps,
  u: { telegramUserId: number; data: string },
): Promise<BotReply | null> {
  const { db } = deps;
  const sender = await senderOf(db, u.telegramUserId);
  if (!sender) return null;
  const [action, id, arg] = u.data.split(':');
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;

  if (action === 'u') return undo(deps, id, sender.id);
  if (action === 'e' || action === 'kc' || action === 'kb')
    return correctionMenu(deps, action, id, sender.id);
  if (action === 'k' || action === 'b') return applyCorrection(deps, action, id, arg ?? '', sender.id);

  // Trava a linha: dois toques rápidos em "Confirmar" não podem lançar duas vezes.
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select({ status: botMessages.status, payload: botMessages.parsedPayload, userId: botMessages.userId })
      .from(botMessages)
      .where(eq(botMessages.id, id))
      .for('update');
    if (!m || m.userId !== sender.id) return { text: 'Só quem enviou a mensagem pode confirmar.' };
    if (m.status !== 'AWAITING_CONFIRMATION') {
      return { text: m.status === 'CREATED' ? 'Já está lançado.' : 'Esse pedido já foi encerrado.' };
    }
    if (action === 'x') {
      await tx.update(botMessages).set({ status: 'REJECTED' }).where(eq(botMessages.id, id));
      return { text: '❌ Cancelado. Nada foi lançado.' };
    }
    if (action !== 'c') return null;
    const draft = pendingPayload.safeParse(m.payload);
    if (!draft.success) {
      await tx
        .update(botMessages)
        .set({ status: 'FAILED', errorMessage: 'payload inválido' })
        .where(eq(botMessages.id, id));
      return { text: 'Não consegui recuperar os dados. Mande a mensagem de novo.' };
    }
    const txDeps = { ...deps, db: tx as unknown as AnyDB };
    const summary = await describe(txDeps.db, draft.data, deps.today());
    return saveDraft(txDeps, id, sender.id, draft.data, summary, null);
  });
}
