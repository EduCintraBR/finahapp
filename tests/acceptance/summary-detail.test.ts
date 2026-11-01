/**
 * Detalhe dos cards da Home (D68), Postgres real: a soma de cada lista é IGUAL ao valor do card (Entrou, Saiu,
 * A receber, A pagar) no mês atual, no passado e nos futuros; e um fixo mensal aparece como despesa nos meses
 * seguintes (antes, os meses futuros ignoravam os fixos nesses cards).
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { listEntries, listPending } from '@/db/queries/entries';
import { cashSummary } from '@/db/queries/reports';
import { summaryDetail, SUMMARY_KINDS, type SummaryKind } from '@/db/queries/summary-detail';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { createCardPurchase } from '@/server/card-purchases';
import { createCard } from '@/server/cards';
import type { ServiceCtx } from '@/server/context';
import { confirmPayment, createEntry } from '@/server/entries';
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

/** O número que o card da Home mostra para cada tipo. */
const cardValue = (s: NonNullable<Awaited<ReturnType<typeof cashSummary>>>, kind: SummaryKind) =>
  ({
    entrou: s.incomeReceivedCents,
    saiu: s.outPaidCents,
    'a-receber': s.incomePendingCents,
    'a-pagar': s.outPendingCents,
  })[kind];

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
});

/** Um mês cheio de tudo: pago, pendente, agendado, fatura, fixos, receita prevista e empréstimo. */
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
  await createTemplate(ctx, template()); // aluguel: pendente de outubro + previsto nos meses seguintes
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
  await createCardPurchase(ctx, {
    cardId: card.id,
    amount: 30_000,
    installments: 1,
    description: 'Compra',
    categoryId: mercado,
    date: '2026-10-12', // depois do fechamento (09/10): cai na fatura que vence em novembro
    beneficiaryUserId: null,
    notes: null,
  });
  await createCardPurchase(ctx, {
    cardId: card.id,
    amount: 45_000,
    installments: 1,
    description: 'Compra antiga',
    categoryId: mercado,
    date: '2026-10-05', // fatura que vence em 16/10 (ainda a pagar)
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

describe('a soma do detalhe é igual ao número do card, em qualquer mês', () => {
  for (const month of ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-03-01']) {
    it(`mês ${month}`, async () => {
      await populate();
      const s = (await cashSummary(db, month, TODAY))!;
      for (const kind of SUMMARY_KINDS) {
        const d = await summaryDetail(db, kind, month, TODAY);
        expect(d.totalCents, `${kind} em ${month}`).toBe(cardValue(s, kind));
      }
    });
  }
});

describe('o que cada card lista', () => {
  beforeEach(populate);
  const names = (d: Awaited<ReturnType<typeof summaryDetail>>) => d.entries.map((e) => e.description).sort();

  it('Entrou: receitas pagas até hoje; sem agendada e sem o valor recebido do empréstimo', async () => {
    const d = await summaryDetail(db, 'entrou', '2026-10-01', TODAY);
    expect(names(d)).toEqual(['Salário']);
    expect(d.totalCents).toBe(100_000);
  });

  it('Saiu: despesas pagas até hoje; sem pendente e sem agendada', async () => {
    const d = await summaryDetail(db, 'saiu', '2026-10-01', TODAY);
    expect(names(d)).toEqual(['Padaria']);
    expect(d.totalCents).toBe(12_345);
  });

  it('A receber: receitas agendadas (e pendentes) do mês', async () => {
    const d = await summaryDetail(db, 'a-receber', '2026-10-01', TODAY);
    expect(names(d)).toEqual(expect.arrayContaining(['Freela']));
    expect(d.invoices).toHaveLength(0);
  });

  it('A pagar: pendentes, agendadas e UMA linha por fatura com o que falta, ligada à fatura', async () => {
    const d = await summaryDetail(db, 'a-pagar', '2026-10-01', TODAY);
    expect(names(d)).toEqual(expect.arrayContaining(['Aluguel', 'Dentista']));
    expect(d.invoices).toHaveLength(1);
    expect(d.invoices[0]).toMatchObject({
      cardName: 'Cartão A',
      remainingCents: 45_000,
      dueDate: '2026-10-16',
    });
    expect(d.invoices[0]!.invoiceId).toMatch(/^[0-9a-f-]{36}$/);
    // D72: a fatura de 16/10 já venceu sem pagamento, então continua em novembro, antes da de novembro
    const nov = await summaryDetail(db, 'a-pagar', '2026-11-01', TODAY);
    expect(nov.invoices.map((i) => [i.dueDate, i.remainingCents])).toEqual([
      ['2026-10-16', 45_000],
      ['2026-11-16', 30_000],
    ]);
  });
});

describe('fixo recorrente aparece nos meses seguintes (correção do D68)', () => {
  beforeEach(populate);

  it('novembro: o aluguel, a luz (dia 31 → 30) e o salário previsto entram em A pagar / A receber', async () => {
    const pagar = await summaryDetail(db, 'a-pagar', '2026-11-01', TODAY);
    expect(pagar.projected.map((p) => [p.description, p.dueDate, p.amountCents])).toEqual([
      ['Aluguel', '2026-11-10', 200_000],
      ['Luz', '2026-11-30', 25_000],
    ]);
    const receber = await summaryDetail(db, 'a-receber', '2026-11-01', TODAY);
    expect(receber.projected.map((p) => [p.description, p.amountCents])).toEqual([
      ['Salário previsto', 800_000],
    ]);

    const s = (await cashSummary(db, '2026-11-01', TODAY))!;
    // aluguel + luz + parcela do empréstimo (R$ 1.000,00) + fatura de novembro (R$ 300,00), mais os atrasados que
    // vêm de outubro (D72): o aluguel de 10/10 e a fatura de 16/10, ainda sem baixa em 17/10
    expect(s.outPendingCents).toBe(200_000 + 25_000 + 100_000 + 30_000 + 200_000 + 45_000);
    // o salário previsto de 05/10 também não foi recebido: segue em novembro junto com o de novembro (D72)
    expect(s.incomePendingCents).toBe(800_000 + 800_000);
  });

  it('o mês atual não duplica: a ocorrência de outubro já está gravada como pendente', async () => {
    const pagar = await summaryDetail(db, 'a-pagar', '2026-10-01', TODAY);
    expect(pagar.projected).toHaveLength(0);
    expect(pagar.entries.filter((e) => e.description === 'Aluguel')).toHaveLength(1);
  });

  it('mês passado não mostra previsão', async () => {
    const d = await summaryDetail(db, 'a-pagar', '2026-09-01', TODAY);
    expect(d.projected).toHaveLength(0);
    expect(d.totalCents).toBe(0);
  });

  it('um fixo encerrado deixa de aparecer a partir do mês seguinte ao último', async () => {
    await createTemplate(
      ctx,
      template({ description: 'Curso', amount: 15_000, dayOfMonth: 20, endMonth: '2026-11-01' }),
    );
    const nov = await summaryDetail(db, 'a-pagar', '2026-11-01', TODAY);
    const dez = await summaryDetail(db, 'a-pagar', '2026-12-01', TODAY);
    expect(nov.projected.map((p) => p.description)).toContain('Curso');
    expect(dez.projected.map((p) => p.description)).not.toContain('Curso');
  });
});

describe('atrasados acompanham os meses seguintes até a baixa (D72)', () => {
  const LATER = '2026-11-20'; // um mês depois: o que venceu em outubro e não foi pago está atrasado
  let luz: string;

  beforeEach(async () => {
    ({ id: luz } = await createEntry(
      ctx,
      entry({ paid: false, amount: 15_000, description: 'Luz', date: '2026-10-20' }),
    ));
    // receita prevista só de outubro (receita lançada à mão já nasce recebida)
    await createTemplate(
      ctx,
      template({
        direction: 'INCOME',
        description: 'Reembolso',
        amount: 40_000,
        dayOfMonth: 25,
        categoryId: salario,
        paymentMethod: 'PIX',
        endMonth: '2026-10-01',
      }),
    );
    await createEntry(
      ctx,
      entry({ paid: false, amount: 9_000, description: 'Internet', date: '2026-11-25' }),
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
    await createCardPurchase(ctx, {
      cardId: card.id,
      amount: 45_000,
      installments: 1,
      description: 'Compra',
      categoryId: mercado,
      date: '2026-10-05', // fatura que vence em 16/10 e nunca foi paga
      beneficiaryUserId: null,
      notes: null,
    });
  });

  it('a soma do detalhe continua igual ao card em todos os meses', async () => {
    for (const month of ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-02-01']) {
      const s = (await cashSummary(db, month, LATER))!;
      for (const kind of SUMMARY_KINDS) {
        const d = await summaryDetail(db, kind, month, LATER);
        expect(d.totalCents, `${kind} em ${month}`).toBe(cardValue(s, kind));
      }
    }
  });

  it('mês atual: A pagar e A receber trazem o atrasado de outubro, e saldo + A receber − A pagar = previsão', async () => {
    const s = (await cashSummary(db, '2026-11-01', LATER))!;
    expect(s.outPendingCents).toBe(15_000 + 9_000 + 45_000);
    expect(s.incomePendingCents).toBe(40_000);
    expect(s.balanceCents + s.incomePendingCents - s.outPendingCents).toBe(s.endOfMonthCents);

    const pagar = await summaryDetail(db, 'a-pagar', '2026-11-01', LATER);
    expect(pagar.entries.map((e) => e.description).sort()).toEqual(['Internet', 'Luz']);
    expect(pagar.invoices.map((i) => [i.dueDate, i.remainingCents])).toEqual([['2026-10-16', 45_000]]);
  });

  it('mês futuro: o atrasado continua; o que vence ainda neste mês (e não atrasou) não', async () => {
    const s = (await cashSummary(db, '2026-12-01', LATER))!;
    expect(s.outPendingCents).toBe(15_000 + 45_000);
    expect(s.incomePendingCents).toBe(40_000);
    expect((await listPending(db, '2026-12-01', LATER)).map((e) => e.description).sort()).toEqual([
      'Luz',
      'Reembolso',
    ]);
  });

  it('mês passado: o que venceu nele ou antes e continua sem baixa', async () => {
    const s = (await cashSummary(db, '2026-10-01', LATER))!;
    expect(s.outPendingCents).toBe(15_000 + 45_000);
    expect(s.incomePendingCents).toBe(40_000);
  });

  it('Saídas (U4) = Saiu + A pagar, e a soma dos detalhes bate', async () => {
    for (const month of ['2026-10-01', '2026-11-01', '2026-12-01']) {
      const s = (await cashSummary(db, month, LATER))!;
      const saiu = await summaryDetail(db, 'saiu', month, LATER);
      const pagar = await summaryDetail(db, 'a-pagar', month, LATER);
      expect(s.outTotalCents, month).toBe(saiu.totalCents + pagar.totalCents);
    }
  });

  it('o extrato do mês traz os atrasados de antes quando pedido (overdueAsOf), e só eles', async () => {
    const plain = await listEntries(db, { month: '2026-11-01' });
    expect(plain.map((e) => e.description).sort()).toEqual(['Internet']);
    const withOverdue = await listEntries(db, { month: '2026-11-01', overdueAsOf: LATER });
    expect(withOverdue.map((e) => e.description).sort()).toEqual(['Internet', 'Luz', 'Reembolso']);
    // mês futuro: o atrasado sim; o que ainda vence neste mês (Internet, 25/11) não
    const dec = await listEntries(db, { month: '2026-12-01', overdueAsOf: LATER });
    expect(dec.map((e) => e.description).sort()).toEqual(['Luz', 'Reembolso']);
  });

  it('depois de pago, sai de todos os meses e entra no "Saiu" do mês em que foi pago', async () => {
    const before = (await cashSummary(db, '2026-11-01', LATER))!;
    const { version } = (
      await q<{ version: number }>('select version from transactions where id = $1', [luz])
    )[0]!;
    await confirmPayment({ ...ctx, today: LATER }, luz, version, { date: LATER, amount: 15_000 });
    for (const month of ['2026-10-01', '2026-11-01', '2026-12-01']) {
      const pagar = await summaryDetail(db, 'a-pagar', month, LATER);
      expect(
        pagar.entries.map((e) => e.description),
        month,
      ).not.toContain('Luz');
    }
    const after = (await cashSummary(db, '2026-11-01', LATER))!;
    expect(after.outPendingCents).toBe(before.outPendingCents - 15_000);
    expect(after.outPaidCents).toBe(before.outPaidCents + 15_000);
    // pagar o que já estava previsto não muda a previsão do fim do mês
    expect(after.endOfMonthCents).toBe(before.endOfMonthCents);
  });
});
