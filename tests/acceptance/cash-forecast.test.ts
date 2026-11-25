/**
 * Previsto dia a dia (D94), Postgres real: o saldo de fim de cada mês do dia a dia é IGUAL ao número que a Início
 * (cashSummary), a Projeção e o bot mostram; o saldo dos dias que já passaram é o saldo real (getAccountBalance);
 * atrasados caem hoje; o mês seguinte começa no previsto do anterior; contas e receitas avulsas de meses futuros
 * entram no estimado (correção da D94); e nada é gravado (nem a fatura da compra simulada).
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { getPrimaryAccount } from '@/db/queries/accounts';
import { getAccountBalance } from '@/db/queries/balance';
import { cashForecast, forecastRange } from '@/db/queries/cash-forecast';
import { cashSummary, projection } from '@/db/queries/reports';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { addDays } from '@/domain/dates';
import { breakdown, groupByMonth } from '@/domain/reports/cash-forecast';
import { createCardPurchase } from '@/server/card-purchases';
import { createCard } from '@/server/cards';
import type { ServiceCtx } from '@/server/context';
import { createEntry } from '@/server/entries';
import { createLoan } from '@/server/loans';
import { createTemplate } from '@/server/recurring';
import type { EntryInput, TemplateInput } from '@/server/schemas';
import { freshDb } from './helpers';

const TODAY = '2026-10-17';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let mercado: string;
let salario: string;
let cardId: string;

const q = async <T>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;

const entry = (over: Partial<EntryInput> = {}): EntryInput => ({
  kind: 'EXPENSE',
  amount: 10_000,
  description: 'Mercado',
  categoryId: mercado,
  paymentMethod: 'PIX',
  date: '2026-10-16',
  beneficiaryUserId: null,
  notes: null,
  ...over,
});

const template = (over: Partial<TemplateInput> = {}): TemplateInput => ({
  type: 'FIXED',
  direction: 'EXPENSE',
  description: 'Aluguel',
  categoryId: mercado,
  amount: 200_000,
  dayOfMonth: 10,
  paymentMethod: 'BOLETO',
  creditCardId: null,
  startMonth: '2026-10-01',
  endMonth: null,
  beneficiaryUserId: null,
  ...over,
});

beforeEach(async () => {
  ({ pg, db } = await freshDb());
  await seed(
    db,
    seedConfigFromEnv({
      SEED_USER1_NAME: 'Eduardo',
      SEED_USER1_EMAIL: 'eduardo@example.com',
      SEED_USER1_PASSWORD: 'senha-do-eduardo',
      SEED_USER2_NAME: 'Viviane',
      SEED_USER2_EMAIL: 'viviane@example.com',
      SEED_USER2_PASSWORD: 'senha-da-viviane',
      SEED_OPENING_BALANCE: '5.000,00',
      SEED_OPENING_BALANCE_DATE: '2026-10-01',
    }),
  );
  mercado = (await q<{ id: string }>(`select id from categories where name = 'Mercado'`))[0]!.id;
  salario = (await q<{ id: string }>(`select id from categories where name = 'Salário CLT'`))[0]!.id;
  const eduardo = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId: eduardo, today: TODAY };
  await populate();
});

/** Tudo o que mexe no previsto: pago, atrasado, pendente, agendado, avulsos futuros, faturas, fixos, assinatura, empréstimo. */
async function populate() {
  await createEntry(
    ctx,
    entry({
      kind: 'INCOME',
      amount: 100_000,
      categoryId: salario,
      description: 'Salário',
      date: '2026-10-05',
    }),
  );
  await createEntry(ctx, entry({ amount: 12_345, description: 'Padaria', date: '2026-10-16' }));
  await createEntry(ctx, entry({ amount: 7_000, description: 'Feira', date: TODAY })); // pago hoje
  await createEntry(
    ctx,
    entry({
      kind: 'INCOME',
      amount: 250_000,
      categoryId: salario,
      description: 'Freela',
      date: '2026-10-25',
    }),
  ); // agendada
  await createEntry(ctx, entry({ amount: 8_000, description: 'Dentista', date: '2026-10-28' })); // agendada
  await createEntry(
    ctx,
    entry({ amount: 3_300, description: 'Conta de água', date: '2026-10-12', paid: false }),
  ); // atrasada
  await createEntry(ctx, entry({ amount: 9_900, description: 'Internet', date: '2026-10-22', paid: false })); // a pagar
  // avulsos de meses futuros (antes ficavam fora do estimado)
  await createEntry(ctx, entry({ amount: 45_090, description: 'IPVA', date: '2026-12-05', paid: false }));
  await createEntry(
    ctx,
    entry({
      kind: 'INCOME',
      amount: 150_000,
      categoryId: salario,
      description: 'Freela de janeiro',
      date: '2027-01-20',
      paid: false,
    }),
  );
  await createTemplate(ctx, template()); // aluguel: pendente (atrasado) em outubro + previsto nos meses seguintes
  await createTemplate(
    ctx,
    template({
      direction: 'INCOME',
      description: 'Salário previsto',
      amount: 800_000,
      dayOfMonth: 5,
      categoryId: salario,
      paymentMethod: 'PIX',
    }),
  );
  await createTemplate(
    ctx,
    template({ type: 'RECURRING_VARIABLE', description: 'Luz', amount: 25_000, dayOfMonth: 31 }),
  );
  const card = await createCard(ctx, {
    name: 'Cartão A',
    issuer: 'Nubank',
    last4: null,
    isAdditional: false,
    holderName: null,
    limitTotal: 500_000,
    closingDay: 9,
    dueDay: 16,
    botAliases: [],
  });
  cardId = card.id;
  await createTemplate(
    ctx,
    template({
      description: 'Streaming',
      amount: 5_590,
      dayOfMonth: 20,
      paymentMethod: 'CREDIT_CARD',
      creditCardId: card.id,
    }),
  );
  await createCardPurchase(ctx, {
    cardId: card.id,
    amount: 30_000,
    installments: 3,
    description: 'Compra',
    categoryId: mercado,
    date: '2026-10-12', // depois do fechamento (09/10): 1ª parcela na fatura de 16/11
    beneficiaryUserId: null,
    notes: null,
  });
  await createCardPurchase(ctx, {
    cardId: card.id,
    amount: 45_000,
    installments: 1,
    description: 'Compra antiga',
    categoryId: mercado,
    date: '2026-10-05', // fatura de 16/10: venceu e não foi paga
    beneficiaryUserId: null,
    notes: null,
  });
  await createLoan(ctx, {
    name: 'Empréstimo',
    lender: null,
    principal: 500_000,
    total: 600_000,
    installments: 6,
    receivedDate: '2026-10-10',
    firstDueDate: '2026-11-10',
    notes: null,
  });
}

const load = async (until: string, today = TODAY) => {
  const r = forecastRange(until, today, 0);
  return (await cashForecast(db, today, r.from, r.to))!;
};

describe('o fim de cada mês bate com a Início, a Projeção e o bot', () => {
  it('mês atual e 6 meses seguintes, encadeados', async () => {
    const f = await load('2027-04-01');
    const months = groupByMonth(f.days);
    expect(months.map((m) => m.month)).toEqual([
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
      '2027-03-01',
      '2027-04-01',
    ]);
    const proj = await projection(db, TODAY, '2027-04-01');
    for (const [i, m] of months.entries()) {
      const s = (await cashSummary(db, m.month, TODAY))!;
      expect(m.closingCents, `fim de ${m.month}`).toBe(s.endOfMonthCents);
      if (i > 0) {
        expect(m.openingCents).toBe(months[i - 1]!.closingCents); // parte do previsto do mês anterior
        expect(m.closingCents).toBe(proj[i - 1]!.estimatedBalanceCents);
        expect(m.closingCents - m.openingCents).toBe(proj[i - 1]!.resultCents);
      }
    }
  });

  it('os dias que já passaram têm o saldo real; o início do mês é o saldo da véspera', async () => {
    const f = await load('2026-10-01');
    const account = (await getPrimaryAccount(db))!;
    expect(f.days[0]!.openingCents).toBe(await getAccountBalance(db, account.id, '2026-09-30'));
    for (const d of f.days.filter((x) => x.date < TODAY)) {
      expect(d.closingCents, d.date).toBe(await getAccountBalance(db, account.id, d.date));
      expect(d.flows.every((x) => x.source === 'REALIZED')).toBe(true);
    }
    // hoje: o saldo real de hoje + o que ainda é previsto para hoje (atrasados)
    const today = f.days.find((d) => d.date === TODAY)!;
    const realizedToday = today.flows.filter((x) => x.source === 'REALIZED');
    expect(realizedToday.map((x) => x.label)).toEqual(['Feira']);
    const forecastToday = today.flows
      .filter((x) => x.source !== 'REALIZED')
      .reduce((s, x) => s + x.amountCents, 0);
    expect(today.closingCents - forecastToday).toBe(await getAccountBalance(db, account.id, TODAY));
  });

  it('mês que já passou: só o saldo real, fechando no saldo do último dia', async () => {
    const later = '2026-11-20';
    const r = forecastRange('2026-10-01', later, 0);
    expect(r).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    const f = (await cashForecast(db, later, r.from, r.to))!;
    const account = (await getPrimaryAccount(db))!;
    expect(f.days.at(-1)!.closingCents).toBe(await getAccountBalance(db, account.id, '2026-10-31'));
    expect(f.days.flatMap((d) => d.flows).every((x) => x.source === 'REALIZED')).toBe(true);
    expect(f.cards).toEqual([]);
  });
});

describe('cada coisa no dia certo', () => {
  const at = async (label: string) => {
    const f = await load('2027-02-01');
    return f.days
      .flatMap((d) => d.flows.map((x) => ({ ...x, day: d.date })))
      .filter((x) => x.label === label);
  };

  it('atrasados (conta, fixo e fatura) caem hoje, marcados, com o vencimento original', async () => {
    expect(await at('Conta de água')).toMatchObject([
      { day: TODAY, originalDate: '2026-10-12', overdue: true, amountCents: -3_300, source: 'PENDING' },
    ]);
    const aluguel = await at('Aluguel');
    expect(aluguel[0]).toMatchObject({
      day: TODAY,
      originalDate: '2026-10-10',
      overdue: true,
      amountCents: -200_000,
    });
    // nos meses seguintes, o aluguel previsto no dia 10
    expect(aluguel.slice(1).map((x) => [x.day, x.source])).toEqual([
      ['2026-11-10', 'FIXED'],
      ['2026-12-10', 'FIXED'],
      ['2027-01-10', 'FIXED'],
      ['2027-02-10', 'FIXED'],
    ]);
    const faturas = await at('Fatura Cartão A');
    expect(faturas[0]).toMatchObject({
      day: TODAY,
      originalDate: '2026-10-16',
      overdue: true,
      amountCents: -45_000,
    });
  });

  it('pendente, agendado, fatura, parcela de empréstimo, avulsos futuros e assinatura no dia do dinheiro', async () => {
    expect((await at('Internet'))[0]).toMatchObject({ day: '2026-10-22', source: 'PENDING', overdue: false });
    expect((await at('Freela'))[0]).toMatchObject({
      day: '2026-10-25',
      source: 'SCHEDULED',
      amountCents: 250_000,
    });
    expect((await at('Dentista'))[0]).toMatchObject({
      day: '2026-10-28',
      source: 'SCHEDULED',
      amountCents: -8_000,
    });
    expect((await at('IPVA'))[0]).toMatchObject({
      day: '2026-12-05',
      source: 'PENDING',
      amountCents: -45_090,
    });
    expect((await at('Freela de janeiro'))[0]).toMatchObject({ day: '2027-01-20', amountCents: 150_000 });
    const loans = (await load('2027-02-01')).days.flatMap((d) => d.flows).filter((x) => x.source === 'LOAN');
    expect(loans.map((x) => [x.date, x.amountCents])).toEqual([
      ['2026-11-10', -100_000],
      ['2026-12-10', -100_000],
      ['2027-01-10', -100_000],
      ['2027-02-10', -100_000],
    ]);
    // fatura de 16/11: só a 1ª parcela da compra (R$ 100); o streaming de 20/10 ainda não foi cobrado (vem abaixo)
    const nov = (await at('Fatura Cartão A')).find((x) => x.day === '2026-11-16')!;
    expect(nov.amountCents).toBe(-10_000);
    const streaming = await at('Streaming');
    expect(streaming.map((x) => [x.day, x.originalDate, x.source])).toEqual([
      ['2026-11-16', '2026-10-20', 'SUBSCRIPTION'], // cobrança de 20/10 → fatura que vence em 16/11
      ['2026-12-16', '2026-11-20', 'SUBSCRIPTION'],
      ['2027-01-16', '2026-12-20', 'SUBSCRIPTION'],
      ['2027-02-16', '2027-01-20', 'SUBSCRIPTION'],
    ]);
  });

  it('a composição do número fecha: Σ partes = fim − início, em cada mês', async () => {
    const months = groupByMonth((await load('2027-02-01')).days);
    for (const m of months) {
      const sum = Object.values(breakdown(m.days)).reduce((s, v) => s + v, 0);
      expect(sum, m.month).toBe(m.closingCents - m.openingCents);
    }
  });
});

describe('correção D94: avulsos de meses futuros entram no estimado', () => {
  it('dezembro desconta o IPVA e janeiro soma o freela, na Projeção e na Início', async () => {
    const proj = await projection(db, TODAY, '2027-01-01');
    const dec = proj.find((r) => r.month === '2026-12-01')!;
    const jan = proj.find((r) => r.month === '2027-01-01')!;
    expect(dec.pendingOutCents).toBe(45_090);
    expect(jan.incomeCents - jan.templateIncomeCents).toBe(150_000);
    // as parcelas do empréstimo continuam só em "Empréstimos" (não contam duas vezes)
    expect(dec.loansCents).toBe(100_000);
    const s = (await cashSummary(db, '2026-12-01', TODAY))!;
    expect(s.endOfMonthCents).toBe(dec.estimatedBalanceCents);
  });
});

describe('cartões: fatura de uma compra feita hoje, sem gravar nada', () => {
  it('vencimentos das parcelas e limite disponível; nenhuma fatura nova no banco', async () => {
    const before = await q<{ n: number }>(`select count(*)::int as n from invoices`);
    const f = await load('2026-10-01');
    const after = await q<{ n: number }>(`select count(*)::int as n from invoices`);
    expect(after[0]!.n).toBe(before[0]!.n);
    const card = f.cards.find((c) => c.id === cardId)!;
    expect(card.dueDates.slice(0, 3)).toEqual(['2026-11-16', '2026-12-16', '2027-01-16']); // 17/10 > fechamento 09/10
    expect(card.dueDates).toHaveLength(12);
    expect(card.availableCents).toBe(500_000 - 30_000 - 45_000);
  });

  it('o horizonte cobre pelo menos `ahead` meses depois do atual', async () => {
    const r = forecastRange('2026-10-01', TODAY, 12);
    expect(r).toEqual({ from: '2026-10-01', to: '2027-10-31' });
    expect(forecastRange('2028-01-01', TODAY, 12).to).toBe('2028-01-31');
    expect(addDays(r.from, -1)).toBe('2026-09-30');
  });
});
