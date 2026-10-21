/**
 * Consultas do bot (Fase 6): limite, pendentes de um mês, resumo de fatura, gastos, resumo do mês e últimos
 * lançamentos. Tudo roda no nosso banco com as mesmas queries do app (os números batem com a Home e os
 * relatórios); o modelo só decide QUAL consulta e QUAL mês, nunca vê saldos nem lançamentos.
 */
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { AnyDB } from '@/db/client';
import { getInvoiceDetail, listActiveCards, listCardInvoices, listCardSummaries } from '@/db/queries/cards';
import { listPending } from '@/db/queries/entries';
import {
  ADJUSTMENTS_KEY,
  cashSummary,
  grossSpend,
  monthlySpend,
  NO_CATEGORY_KEY,
  total,
} from '@/db/queries/reports';
import { categories, creditCards, transactions } from '@/db/schema';
import {
  compareDates,
  formatDateBR,
  formatMonthLabel,
  monthEnd,
  monthStart,
  type ISODate,
} from '@/domain/dates';
import { parseMonthArg } from '@/domain/month-ref';
import { formatBRL } from '@/domain/money';
import { PAYMENT_METHOD_LABEL } from '@/lib/labels';
import type { BotQuery } from './parser';

const STATE_LABEL: Record<string, string> = {
  OPEN: 'aberta',
  CLOSED: 'fechada',
  OVERDUE: 'atrasada',
  PAID: 'paga',
};

const MAX_LINES = 12;
const ddmm = (d: ISODate) => formatDateBR(d).slice(0, 5);

/** Limite dos cartões: um (se citado) ou todos. */
export async function limitText(db: AnyDB, today: ISODate, cardId: string | null): Promise<string> {
  const cards = await listCardSummaries(db, today, cardId ? { cardId } : {});
  if (cards.length === 0) return cardId ? 'Cartão não encontrado.' : 'Nenhum cartão cadastrado.';
  return cards
    .map((c) => {
      const lines = [`💳 ${c.card.name}`];
      if (c.limitTotalCents !== null && c.availableCents !== null) {
        const used = c.limitTotalCents > 0 ? Math.round((c.committedCents * 100) / c.limitTotalCents) : 0;
        lines.push(
          `Limite: ${formatBRL(c.limitTotalCents)} · em uso: ${formatBRL(c.committedCents)} (${used}%)`,
          `Disponível: ${formatBRL(c.availableCents)}`,
        );
      } else {
        lines.push(
          `Comprometido: ${formatBRL(c.committedCents)} (cartão adicional: o limite não é rastreado)`,
        );
      }
      const cur = c.currentInvoice;
      lines.push(
        `Fatura aberta de ${formatMonthLabel(cur.referenceMonth)}: ${formatBRL(cur.totalCents)} · fecha ${ddmm(cur.closingDate)} · vence ${ddmm(cur.dueDate)}`,
      );
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * Contas pendentes do mês. Mês atual: o que vence no mês e o que já está atrasado (como a Home). Outro mês:
 * só o que vence nele. Inclui o que falta pagar das faturas que vencem no período.
 */
export async function pendingMonthText(db: AnyDB, today: ISODate, month: ISODate | null): Promise<string> {
  const current = monthStart(today);
  const m = month ?? current;
  const isCurrent = m === current;
  const end = monthEnd(m);
  const label = formatMonthLabel(m);

  const dueOf = (r: { dueDate: ISODate | null; date: ISODate }) => r.dueDate ?? r.date;
  const rows = (await listPending(db, m)).filter((r) => isCurrent || compareDates(dueOf(r), m) >= 0);

  const cards = await listActiveCards(db);
  const invoices: { card: string; ref: ISODate; due: ISODate; remaining: number }[] = [];
  for (const c of cards) {
    for (const i of await listCardInvoices(db, c.id, today)) {
      const inWindow = compareDates(i.dueDate, end) <= 0 && (isCurrent || compareDates(i.dueDate, m) >= 0);
      if (i.remainingCents > 0 && inWindow) {
        invoices.push({ card: c.name, ref: i.referenceMonth, due: i.dueDate, remaining: i.remainingCents });
      }
    }
  }

  const items = [
    ...rows.map((r) => ({
      due: dueOf(r),
      text: `${r.description}: ${r.kind === 'INCOME' ? 'receber' : 'pagar'} ${formatBRL(r.amountCents)}`,
    })),
    ...invoices.map((i) => ({
      due: i.due,
      text: `Fatura ${i.card} (${formatMonthLabel(i.ref)}): pagar ${formatBRL(i.remaining)}`,
    })),
  ].sort((a, b) => compareDates(a.due, b.due));

  const title = isCurrent ? `Pendentes até o fim de ${label} (com atrasados):` : `Pendentes de ${label}:`;
  if (items.length === 0) return `${isCurrent ? 'Nada pendente' : `Nada pendente em ${label}`}. 🎉`;

  const tag = (d: ISODate) => (d < today ? ' ⚠️ atrasado' : d === today ? ' · vence hoje' : '');
  const shown = items.slice(0, MAX_LINES).map((i) => `• ${ddmm(i.due)} ${i.text}${tag(i.due)}`);
  if (items.length > MAX_LINES) shown.push(`… e mais ${items.length - MAX_LINES}. Veja todas no app.`);

  const toPay =
    rows.filter((r) => r.kind !== 'INCOME').reduce((s, r) => s + r.amountCents, 0) +
    invoices.reduce((s, i) => s + i.remaining, 0);
  const toReceive = rows.filter((r) => r.kind === 'INCOME').reduce((s, r) => s + r.amountCents, 0);
  const sums = [
    `A pagar: ${formatBRL(toPay)}`,
    ...(toReceive > 0 ? [`A receber: ${formatBRL(toReceive)}`] : []),
  ];
  return [title, ...shown, '', sums.join(' · ')].join('\n');
}

/** Resumo da fatura de um cartão. Sem mês: a fatura aberta (e um aviso se houver outra fechada a pagar). */
export async function invoiceSummaryText(
  db: AnyDB,
  today: ISODate,
  cardId: string | null,
  month: ISODate | null,
): Promise<string> {
  const cards = await listActiveCards(db);
  if (cards.length === 0) return 'Nenhum cartão cadastrado.';
  const card = cardId ? cards.find((c) => c.id === cardId) : cards.length === 1 ? cards[0] : undefined;
  if (!card) {
    return `Qual cartão? ${cards.map((c) => c.name).join(', ')}.\nEx.: /fatura ${cards[0]!.name.split(' ')[0]!.toLowerCase()}`;
  }
  const [s] = await listCardSummaries(db, today, { cardId: card.id });
  if (!s) return 'Cartão não encontrado.';

  const target = month
    ? (await listCardInvoices(db, card.id, today)).find((i) => i.referenceMonth === month)
    : s.currentInvoice;
  if (!target) return `Não achei a fatura de ${formatMonthLabel(month!)} do ${card.name}.`;

  const lines = [
    `💳 ${card.name} · fatura de ${formatMonthLabel(target.referenceMonth)} (${STATE_LABEL[target.state] ?? target.state})`,
    target.paidCents > 0
      ? `Total: ${formatBRL(target.totalCents)} · pago: ${formatBRL(target.paidCents)} · falta: ${formatBRL(target.remainingCents)}`
      : `Total: ${formatBRL(target.totalCents)}`,
    `Fecha ${formatDateBR(target.closingDate)} · vence ${formatDateBR(target.dueDate)}`,
  ];

  const detail = target.id ? await getInvoiceDetail(db, target.id, today) : null;
  const active = (detail?.items ?? []).filter((i) => i.status === 'ACTIVE');
  if (active.length === 0) {
    lines.push('Sem lançamentos nesta fatura.');
  } else {
    const charges = active.filter((i) => i.amountCents > 0);
    const credits = active.reduce((sum, i) => sum + (i.amountCents < 0 ? i.amountCents : 0), 0);
    lines.push('', `${charges.length} ${charges.length === 1 ? 'lançamento' : 'lançamentos'}. Maiores:`);
    for (const i of [...charges].sort((a, b) => b.amountCents - a.amountCents).slice(0, 5)) {
      // a descrição do item já traz a parcela ("Tênis (1/3)")
      lines.push(`• ${i.description} — ${formatBRL(i.amountCents)}`);
    }
    const byCat = new Map<string, number>();
    for (const i of charges) {
      const k = i.categoryName ?? (i.kind === 'ADJUSTMENT' ? 'Ajustes' : 'Sem categoria');
      byCat.set(k, (byCat.get(k) ?? 0) + i.amountCents);
    }
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (top.length > 1)
      lines.push('', `Por categoria: ${top.map(([k, v]) => `${k} ${formatBRL(v)}`).join(' · ')}`);
    if (credits < 0) lines.push(`Créditos/estornos: ${formatBRL(credits)}`);
  }

  if (!month) {
    for (const u of s.unpaidClosed.filter((u) => u.referenceMonth !== target.referenceMonth)) {
      lines.push(
        '',
        `${u.state === 'OVERDUE' ? '⚠️ Atrasada' : 'Fechada'}: fatura de ${formatMonthLabel(u.referenceMonth)}, falta pagar ${formatBRL(u.remainingCents)} até ${formatDateBR(u.dueDate)}`,
      );
    }
  }
  if (s.availableCents !== null) lines.push('', `Limite disponível: ${formatBRL(s.availableCents)}`);
  return lines.join('\n');
}

const categoryNames = async (db: AnyDB) =>
  new Map(
    (await db.select({ id: categories.id, name: categories.name }).from(categories)).map((c) => [
      c.id,
      c.name,
    ]),
  );

/** Gastos do mês (Bruto = compras do mês; Mensal = o que sai da conta no mês), geral ou de uma categoria. */
export async function spendingText(
  db: AnyDB,
  today: ISODate,
  month: ISODate | null,
  categoryId: string | null,
): Promise<string> {
  const current = monthStart(today);
  const m = month ?? current;
  const to = monthEnd(m);
  const filters = categoryId ? { categoryId } : {};
  const [gross, monthly, names] = await Promise.all([
    grossSpend(db, m, to, 'category', filters),
    monthlySpend(db, m, to, 'category', filters),
    categoryNames(db),
  ]);
  const label = formatMonthLabel(m);
  const nameOf = (k: string) =>
    k === ADJUSTMENTS_KEY
      ? 'Ajustes de fatura'
      : k === NO_CATEGORY_KEY
        ? 'Sem categoria'
        : (names.get(k) ?? 'Outra');

  const lines = [
    categoryId ? `${names.get(categoryId) ?? 'Categoria'} em ${label}` : `Gastos de ${label}`,
    `Compras do mês (Bruto): ${formatBRL(total(gross))}`,
    `Sai da conta no mês (Mensal): ${formatBRL(total(monthly))}`,
  ];
  if (!categoryId) {
    const top = [...gross.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    if (top.length > 0) {
      lines.push('', 'Por categoria (compras):', ...top.map(([k, v]) => `• ${nameOf(k)} — ${formatBRL(v)}`));
    }
  }
  if (compareDates(m, current) > 0)
    lines.push('', 'Mês futuro: só aparece o que já foi lançado ou agendado.');
  return lines.join('\n');
}

/** Resumo do mês: o que entrou, saiu, falta e o saldo no fim do mês (previsto, real ou estimado). */
export async function monthSummaryText(db: AnyDB, today: ISODate, month: ISODate | null): Promise<string> {
  const m = month ?? monthStart(today);
  const s = await cashSummary(db, m, today);
  if (!s) return 'A conta principal ainda não foi configurada.';
  const endLabel = {
    projected: 'Saldo previsto no fim do mês',
    actual: 'Saldo no fim do mês',
    estimated: 'Saldo estimado no fim do mês',
  }[s.endOfMonthKind];
  return [
    `Resumo de ${formatMonthLabel(m)}`,
    `Entrou: ${formatBRL(s.incomeReceivedCents)} · saiu: ${formatBRL(s.outPaidCents)}`,
    `Falta receber: ${formatBRL(s.incomePendingCents)} · falta pagar: ${formatBRL(s.outPendingCents)} (contas + faturas)`,
    `${endLabel}: ${formatBRL(s.endOfMonthCents)}`,
  ].join('\n');
}

/** Os últimos lançamentos (conta e cartão), do mais recente ao mais antigo. */
export async function recentText(db: AnyDB): Promise<string> {
  const rows = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      amountCents: transactions.amountCents,
      kind: transactions.kind,
      date: transactions.transactionDate,
      category: categories.name,
      method: transactions.paymentMethod,
      card: creditCards.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(creditCards, eq(creditCards.id, transactions.creditCardId))
    .where(
      and(
        isNull(transactions.deletedAt),
        inArray(transactions.kind, ['EXPENSE', 'INCOME']),
        eq(transactions.status, 'POSTED'),
        ne(transactions.source, 'ONBOARDING'),
      ),
    )
    .orderBy(desc(transactions.transactionDate), desc(transactions.createdAt))
    .limit(6);
  if (rows.length === 0) return 'Nenhum lançamento ainda.';
  return [
    'Últimos lançamentos:',
    ...rows.map((r) => {
      const how = r.card ?? PAYMENT_METHOD_LABEL[r.method ?? 'OTHER'] ?? '';
      const value = `${r.kind === 'INCOME' ? '+ ' : ''}${formatBRL(r.amountCents)}`;
      return `• ${ddmm(r.date)} ${r.description} — ${value} (${[r.category, how].filter(Boolean).join(' · ')})`;
    }),
  ].join('\n');
}

/** Executa uma consulta já validada pelo parser. */
export async function runQuery(
  db: AnyDB,
  today: ISODate,
  q: BotQuery,
  balance: (db: AnyDB, today: ISODate) => Promise<string>,
): Promise<string> {
  switch (q.type) {
    case 'BALANCE':
      return balance(db, today);
    case 'LIMIT':
      return limitText(db, today, q.cardId);
    case 'PENDING':
      return pendingMonthText(db, today, q.month);
    case 'INVOICE':
      return invoiceSummaryText(db, today, q.cardId, q.month);
    case 'SPENDING':
      return spendingText(db, today, q.month, q.categoryId);
    case 'MONTH_SUMMARY':
      return monthSummaryText(db, today, q.month);
    case 'RECENT':
      return recentText(db);
  }
}

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Argumentos de comando: "/fatura nubank novembro" → cartão + mês. O cartão é achado pelo nome ou apelido
 * (o mais longo que aparece no texto); o que sobra é o mês. Sem cartão e sem mês = padrões da consulta.
 */
export function parseCardAndMonth(
  args: string,
  cards: readonly { id: string; name: string; botAliases: readonly string[] }[],
  today: ISODate,
): { ok: true; cardId: string | null; month: ISODate | null } | { ok: false; error: string } {
  let rest = ` ${plain(args)} `;
  let best: { id: string; term: string } | null = null;
  for (const c of cards) {
    for (const term of [c.name, ...c.botAliases].map(plain)) {
      if (term.length >= 2 && rest.includes(` ${term} `) && (!best || term.length > best.term.length)) {
        best = { id: c.id, term };
      }
    }
  }
  if (best) rest = rest.replace(` ${best.term} `, ' ');
  const month = parseMonthArg(rest.trim(), today);
  if (!month.ok) {
    return {
      ok: false,
      error: 'Não entendi o mês. Use o nome ("novembro"), "11/2026", "próximo" ou "passado".',
    };
  }
  return { ok: true, cardId: best?.id ?? null, month: month.month };
}
