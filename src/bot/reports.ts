/**
 * Consultas do bot (Fase 4): /saldo, /fatura, /pendentes e os lembretes diários das 9h (D43).
 * Mesmas queries da Home — os números do bot batem com os do app.
 */
import { isNotNull } from 'drizzle-orm';
import type { AnyDB } from '@/db/client';
import { listCardSummaries } from '@/db/queries/cards';
import { listPending } from '@/db/queries/entries';
import { cashSummary } from '@/db/queries/reports';
import { users } from '@/db/schema';
import { addDays, formatDateBR, formatMonthLabel, monthStart, type ISODate } from '@/domain/dates';
import { formatBRL } from '@/domain/money';

export async function balanceText(db: AnyDB, today: ISODate): Promise<string> {
  const s = await cashSummary(db, monthStart(today), today);
  if (!s) return 'A conta principal ainda não foi configurada.';
  return [
    `Saldo atual: ${formatBRL(s.balanceCents)}`,
    `Previsto para o fim do mês: ${formatBRL(s.endOfMonthCents)}`,
    '',
    `No mês: entrou ${formatBRL(s.incomeReceivedCents)} · saiu ${formatBRL(s.outPaidCents)}`,
    `Falta: receber ${formatBRL(s.incomePendingCents)} · pagar ${formatBRL(s.outPendingCents)}`,
  ].join('\n');
}

export async function invoicesText(db: AnyDB, today: ISODate): Promise<string> {
  const cards = await listCardSummaries(db, today);
  if (cards.length === 0) return 'Nenhum cartão cadastrado.';
  return cards
    .map((c) => {
      const cur = c.currentInvoice;
      const lines = [
        `💳 ${c.card.name}`,
        `Fatura de ${formatMonthLabel(cur.referenceMonth)} (aberta): ${formatBRL(cur.totalCents)} · fecha ${formatDateBR(cur.closingDate)} · vence ${formatDateBR(cur.dueDate)}`,
      ];
      for (const u of c.unpaidClosed) {
        lines.push(
          `${u.state === 'OVERDUE' ? '⚠️ Atrasada' : 'Fechada'}: fatura de ${formatMonthLabel(u.referenceMonth)}, falta pagar ${formatBRL(u.remainingCents)} até ${formatDateBR(u.dueDate)}`,
        );
      }
      if (c.availableCents !== null) lines.push(`Limite disponível: ${formatBRL(c.availableCents)}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

export async function pendingText(db: AnyDB, today: ISODate): Promise<string> {
  const rows = await listPending(db, monthStart(today));
  if (rows.length === 0) return `Nada pendente até o fim de ${formatMonthLabel(monthStart(today))}. 🎉`;
  const lines = rows.map((r) => {
    const due = r.dueDate ?? r.date;
    const tag = due < today ? ' ⚠️ atrasado' : due === today ? ' · vence hoje' : '';
    const sign = r.kind === 'INCOME' ? 'receber' : 'pagar';
    return `• ${formatDateBR(due)} ${r.description}: ${sign} ${formatBRL(r.amountCents)}${tag}`;
  });
  return [`Pendentes até o fim de ${formatMonthLabel(monthStart(today))}:`, ...lines].join('\n');
}

/**
 * D43: contas pendentes que vencem hoje + faturas que vencem em 2 dias com valor a pagar.
 * Sem nada a lembrar → null (nenhuma mensagem).
 */
export async function reminderText(db: AnyDB, today: ISODate): Promise<string | null> {
  const inTwoDays = addDays(today, 2);
  const [pending, cards] = await Promise.all([
    listPending(db, monthStart(today)),
    listCardSummaries(db, today),
  ]);
  const dueToday = pending.filter((p) => p.dueDate === today);
  const invoicesSoon = cards.flatMap((c) =>
    [c.currentInvoice, ...c.unpaidClosed]
      .filter((i) => i.dueDate === inTwoDays && i.remainingCents > 0)
      .map((i) => ({ card: c.card.name, ...i })),
  );
  // a mesma fatura pode estar em currentInvoice e unpaidClosed: uma linha por (cartão, mês)
  const seen = new Set<string>();
  const uniqueInvoices = invoicesSoon.filter((i) => {
    const k = `${i.card}|${i.referenceMonth}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (dueToday.length === 0 && uniqueInvoices.length === 0) return null;
  const lines = ['⏰ Lembretes de hoje'];
  if (dueToday.length) {
    lines.push('', 'Vencem hoje:');
    for (const p of dueToday) {
      lines.push(
        `• ${p.description}: ${p.kind === 'INCOME' ? 'receber' : 'pagar'} ${formatBRL(p.amountCents)}`,
      );
    }
  }
  if (uniqueInvoices.length) {
    lines.push('', `Faturas que vencem em ${formatDateBR(inTwoDays)}:`);
    for (const i of uniqueInvoices) lines.push(`• ${i.card}: falta pagar ${formatBRL(i.remainingCents)}`);
  }
  lines.push('', 'Para dar baixa, abra o app (Início → Pendentes).');
  return lines.join('\n');
}

/** Destinatários dos lembretes: usuários com Telegram cadastrado (chat privado = id do usuário). */
export async function reminderRecipients(db: AnyDB): Promise<number[]> {
  const rows = await db
    .select({ tg: users.telegramUserId })
    .from(users)
    .where(isNotNull(users.telegramUserId));
  return rows.flatMap((r) => (r.tg ? [r.tg] : []));
}

/** Envia o lembrete do dia (se houver) para os dois; devolve quantas mensagens foram enviadas. */
export async function sendReminders(
  db: AnyDB,
  today: ISODate,
  send: (chatId: number, text: string) => Promise<unknown>,
): Promise<number> {
  const text = await reminderText(db, today);
  if (!text) return 0;
  let sentCount = 0;
  for (const chatId of await reminderRecipients(db)) {
    try {
      await send(chatId, text);
      sentCount++;
    } catch (err) {
      console.error('[bot] lembrete não enviado para', chatId, err);
    }
  }
  return sentCount;
}
