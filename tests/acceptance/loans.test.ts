/**
 * Empréstimo (D66), Postgres real (PGlite): o valor recebido entra no saldo mas não nas receitas; o total com juros
 * vira parcelas pendentes (despesa, entram na projeção); pagar adiantado calcula o desconto, pagar atrasado mostra o
 * acréscimo; várias parcelas de uma vez; exclusão só antes do primeiro pagamento.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { getAccountBalance } from '@/db/queries/balance';
import { listEntries } from '@/db/queries/entries';
import { getLoan, listLoans } from '@/db/queries/loans';
import { cashSummary, grossSpend, monthlySpend, projection, total } from '@/db/queries/reports';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { confirmPayment, removeEntry, revertPayment, updateEntry } from '@/server/entries';
import type { ServiceCtx } from '@/server/context';
import { createLoan, deleteLoan, payLoanInstallments } from '@/server/loans';
import { freshDb } from './helpers';

const TODAY = '2026-10-21';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let accountId: string;
let loanId: string;

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;
const at = (today: string): ServiceCtx => ({ ...ctx, today });
const balance = () => getAccountBalance(db, accountId);
const loan = async (today = TODAY) => (await getLoan(db, loanId, today))!;

const create = (overrides: Partial<Parameters<typeof createLoan>[1]> = {}) =>
  createLoan(ctx, {
    name: 'Empréstimo pessoal',
    lender: 'Banco X',
    principal: 1_000_000, // R$ 10.000,00 recebidos
    total: 1_200_000, // R$ 12.000,00 a pagar (com juros)
    installments: 12,
    receivedDate: '2026-10-21',
    firstDueDate: '2026-11-10',
    notes: null,
    ...overrides,
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
      SEED_OPENING_BALANCE: '1.000,00',
      SEED_OPENING_BALANCE_DATE: '2026-09-01',
    }),
  );
  accountId = (await q<{ id: string }>(`select id from bank_accounts`))[0]!.id;
  const userId = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId, today: TODAY };
  ({ id: loanId } = await create());
});

describe('cadastro', () => {
  it('o valor recebido entra no saldo da conta, mas não conta como receita do mês', async () => {
    expect(await balance()).toBe(100_000 + 1_000_000);
    const s = (await cashSummary(db, '2026-10-01', TODAY))!;
    expect(s.incomeReceivedCents).toBe(0); // "Entrou do mês" não inclui o empréstimo
    expect(s.balanceCents).toBe(1_100_000);
  });

  it('o total com juros vira 12 parcelas pendentes que somam exatamente o total', async () => {
    const l = await loan();
    expect(l.installments).toHaveLength(12);
    expect(l.installments.reduce((s, i) => s + i.scheduledCents, 0)).toBe(1_200_000);
    expect(l.installments.every((i) => i.paidCents === null)).toBe(true);
    expect(l.installments[0]!.dueDate).toBe('2026-11-10');
    expect(l.installments[11]!.dueDate).toBe('2027-10-10');
    expect(l.interestCents).toBe(200_000);
    expect(l.summary.remainingCents).toBe(1_200_000);
    expect(l.summary.nextDueDate).toBe('2026-11-10');
  });

  it('resto do arredondamento vai na 1ª parcela', async () => {
    const other = await create({ name: 'Pequeno', principal: 10_000, total: 10_000, installments: 3 });
    const l = (await getLoan(db, other.id, TODAY))!;
    expect(l.installments.map((i) => i.scheduledCents)).toEqual([3334, 3333, 3333]);
  });

  it('valida: total menor que o recebido, 1ª parcela antes de receber, data futura', async () => {
    await expect(create({ total: 900_000 })).rejects.toThrow();
    await expect(create({ receivedDate: '2026-10-22' })).rejects.toThrow('futuro');
    await expect(create({ receivedDate: '2026-08-31' })).rejects.toThrow('início do controle');
  });

  it('as parcelas e o valor recebido ficam fora da edição comum de lançamentos', async () => {
    const [p] = await q<{ id: string; version: number }>(
      `select id, version from transactions where loan_installment_number = 1`,
    );
    await expect(removeEntry(ctx, p!.id, p!.version)).rejects.toThrow('tela do empréstimo');
    const [inc] = await q<{ id: string; version: number }>(
      `select id, version from transactions where loan_id is not null and kind = 'INCOME'`,
    );
    await expect(removeEntry(ctx, inc!.id, inc!.version)).rejects.toThrow('tela do empréstimo');
    await expect(
      updateEntry(ctx, p!.id, p!.version, {
        kind: 'EXPENSE',
        amount: 1,
        description: 'x',
        categoryId: (await q<{ id: string }>(`select id from categories where name = 'Mercado'`))[0]!.id,
        paymentMethod: 'PIX',
        date: TODAY,
        beneficiaryUserId: null,
        notes: null,
      }),
    ).rejects.toThrow('tela do empréstimo');
  });
});

describe('pagamento', () => {
  const idsOf = async (numbers: number[]) =>
    (await loan()).installments.filter((i) => numbers.includes(i.number)).map((i) => i.id);
  const pay = (numbers: number[], paid: number, date: string, today = date) =>
    idsOf(numbers).then((installmentIds) =>
      payLoanInstallments(at(today), loanId, { installmentIds, paid, date }),
    );

  it('em dia, valor cheio: sem desconto nem acréscimo, sai do saldo na data paga', async () => {
    const r = await pay([1], 100_000, '2026-11-10');
    expect(r).toEqual({ scheduledCents: 100_000, paidCents: 100_000, savingsCents: 0, lateFeesCents: 0 });
    expect(await balance()).toBe(1_100_000 - 100_000);
    const l = await loan('2026-11-10');
    expect(l.summary.paidCents).toBe(100_000);
    expect(l.summary.remainingCents).toBe(1_100_000);
    expect(l.installments[0]!.daysEarly).toBe(0);
  });

  it('adiantar com desconto: o desconto é programado − pago, e a data é comparada com o vencimento', async () => {
    // paga a parcela 12 (vence 10/10/2027) hoje, 21/10/2026, com R$ 200,00 de desconto
    const r = await pay([12], 98_000 - 18_000, '2026-10-21');
    expect(r.savingsCents).toBe(100_000 - 80_000);
    const l = await loan();
    const p = l.installments.find((i) => i.number === 12)!;
    expect(p.scheduledCents).toBe(100_000);
    expect(p.paidCents).toBe(80_000);
    expect(p.paidDate).toBe('2026-10-21');
    expect(p.daysEarly).toBeGreaterThan(300); // adiantou quase um ano
    expect(l.summary.savingsCents).toBe(20_000);
    expect(l.summary.remainingCents).toBe(1_100_000);
    expect(await balance()).toBe(1_100_000 - 80_000);
  });

  it('várias parcelas de uma vez (as últimas): um valor só, rateado, soma exata', async () => {
    const r = await pay([10, 11, 12], 270_000, '2026-10-21'); // 3 × 1.000,00 = 3.000,00 por 2.700,00
    expect(r).toEqual({
      scheduledCents: 300_000,
      paidCents: 270_000,
      savingsCents: 30_000,
      lateFeesCents: 0,
    });
    const l = await loan();
    const paid = l.installments.filter((i) => i.paidCents !== null);
    expect(paid.map((i) => i.number)).toEqual([10, 11, 12]);
    expect(paid.reduce((s, i) => s + i.paidCents!, 0)).toBe(270_000);
    expect(l.summary.savingsCents).toBe(30_000);
    expect(await balance()).toBe(1_100_000 - 270_000);
  });

  it('pagar mais que o programado (atraso): o acréscimo aparece e a despesa conta o valor realmente pago', async () => {
    const r = await pay([1], 103_500, '2026-11-17');
    expect(r.lateFeesCents).toBe(3_500);
    expect(r.savingsCents).toBe(0);
    const l = await loan('2026-11-17');
    expect(l.summary.lateFeesCents).toBe(3_500);
    expect(l.installments[0]!.daysEarly).toBe(-7);
    expect(total(await monthlySpend(db, '2026-11-01', '2026-11-30', 'category'))).toBe(103_500);
  });

  it('quita o empréstimo: sem pendências, quitado', async () => {
    await pay([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 1_100_000, '2026-10-21');
    const l = await loan();
    expect(l.summary.settled).toBe(true);
    expect(l.summary.remainingCents).toBe(0);
    expect(l.summary.savingsCents).toBe(100_000);
    expect((await listLoans(db, TODAY)).map((x) => x.summary.settled)).toEqual([true]);
  });

  it('recusa parcela já paga, parcela de outro empréstimo, data futura e valor mínimo', async () => {
    await pay([1], 100_000, '2026-10-21');
    await expect(pay([1], 100_000, '2026-10-21')).rejects.toThrow('já está paga');
    const other = await create({ name: 'Outro', principal: 50_000, total: 60_000, installments: 6 });
    const foreign = (await getLoan(db, other.id, TODAY))!.installments[0]!.id;
    await expect(
      payLoanInstallments(ctx, loanId, { installmentIds: [foreign], paid: 10_000, date: TODAY }),
    ).rejects.toThrow('não encontrada');
    await expect(pay([2], 100_000, '2026-10-22', TODAY)).rejects.toThrow('futuro');
    await expect(pay([2, 3, 4], 2, TODAY)).rejects.toThrow('R$ 0,01');
  });

  it('desfazer o pagamento pela baixa comum volta a parcela para pendente com o valor programado', async () => {
    await pay([2], 90_000, '2026-10-21');
    const [row] = await q<{ id: string; version: number }>(
      `select id, version from transactions where loan_installment_number = 2`,
    );
    await revertPayment(ctx, row!.id, row!.version);
    const l = await loan();
    const p = l.installments.find((i) => i.number === 2)!;
    expect(p.paidCents).toBeNull();
    expect(p.scheduledCents).toBe(100_000);
    expect(l.summary.savingsCents).toBe(0);
    // a competência volta para o vencimento (enquanto paga, contava no mês do pagamento)
    const [t] = await q<{ d: string; due: string }>(
      `select transaction_date::text as d, due_date::text as due from transactions where id = $1`,
      [row!.id],
    );
    expect(t!.d).toBe(t!.due);
  });

  it('a baixa comum ("Paguei") de uma parcela também calcula o desconto', async () => {
    const [row] = await q<{ id: string; version: number }>(
      `select id, version from transactions where loan_installment_number = 3`,
    );
    await confirmPayment(ctx, row!.id, row!.version, { date: TODAY, amount: 95_000 });
    expect((await loan()).summary.savingsCents).toBe(5_000);
  });
});

describe('relatórios e projeção', () => {
  it('parcelas pagas contam como despesa (Gasto Bruto e Mensal) e o recebimento não conta em nada', async () => {
    expect(total(await grossSpend(db, '2026-10-01', '2026-10-31', 'category'))).toBe(0);
    const ids = (await loan()).installments.slice(0, 2).map((i) => i.id);
    await payLoanInstallments(ctx, loanId, { installmentIds: ids, paid: 200_000, date: TODAY });
    expect(total(await grossSpend(db, '2026-10-01', '2026-10-31', 'category'))).toBe(200_000);
    expect(total(await monthlySpend(db, '2026-10-01', '2026-10-31', 'category'))).toBe(200_000);
  });

  it('a projeção desconta as parcelas pendentes de cada mês futuro', async () => {
    const rows = await projection(db, TODAY, '2027-01-01');
    // nov, dez, jan: uma parcela de R$ 1.000,00 cada
    expect(rows.map((r) => r.loansCents)).toEqual([100_000, 100_000, 100_000]);
    expect(rows[0]!.resultCents).toBe(-100_000);
  });

  it('pendentes do mês corrente entram na previsão do fim do mês', async () => {
    const l = await createLoan(ctx, {
      name: 'Curto',
      lender: null,
      principal: 30_000,
      total: 30_000,
      installments: 3,
      receivedDate: '2026-10-21',
      firstDueDate: '2026-10-25',
      notes: null,
    });
    expect(l.id).toBeTruthy();
    const s = (await cashSummary(db, '2026-10-01', TODAY))!;
    expect(s.outPendingCents).toBe(10_000); // a parcela de 25/10
  });

  it('o extrato mostra o recebimento e as parcelas como lançamentos da conta', async () => {
    const entries = await listEntries(db, { month: '2026-10-01' });
    expect(entries.map((e) => e.description)).toEqual(
      expect.arrayContaining([expect.stringContaining('Empréstimo recebido')]),
    );
  });
});

describe('excluir', () => {
  it('antes de pagar qualquer parcela: tira o valor recebido do saldo e some com as parcelas', async () => {
    await deleteLoan(ctx, loanId);
    expect(await balance()).toBe(100_000);
    expect(await getLoan(db, loanId, TODAY)).toBeNull();
    expect(await listLoans(db, TODAY)).toHaveLength(0);
    const left = await q(`select 1 from transactions where loan_id = $1 and deleted_at is null`, [loanId]);
    expect(left).toHaveLength(0);
    const kept = await q(`select 1 from transactions where loan_id = $1`, [loanId]); // nada some de verdade
    expect(kept).toHaveLength(13);
    await expect(deleteLoan(ctx, loanId)).rejects.toThrow('não encontrado');
  });

  it('depois de pagar uma parcela, não pode mais', async () => {
    const id = (await loan()).installments[0]!.id;
    await payLoanInstallments(ctx, loanId, { installmentIds: [id], paid: 100_000, date: TODAY });
    await expect(deleteLoan(ctx, loanId)).rejects.toThrow('já tem parcela paga');
    expect(await balance()).toBe(1_100_000 - 100_000);
  });
});

describe('constraints do banco', () => {
  it('parcela sem empréstimo, ou duas parcelas com o mesmo número, é recusada', async () => {
    const cat = (await q<{ id: string }>(`select id from categories where name = 'Mercado'`))[0]!.id;
    await expect(
      pg.query(
        `insert into transactions (kind, description, amount_cents, payment_method, bank_account_id, category_id, transaction_date, posted_date, created_by_user_id, loan_installment_number)
         values ('EXPENSE','x',100,'PIX',$1,$2,'2026-10-21','2026-10-21',$3,1)`,
        [accountId, cat, ctx.userId],
      ),
    ).rejects.toThrow();
    await expect(
      pg.query(
        `insert into transactions (kind, status, description, amount_cents, payment_method, bank_account_id, category_id, transaction_date, due_date, created_by_user_id, loan_id, loan_installment_number)
         values ('EXPENSE','PENDING','x',100,'OTHER',$1,$2,'2026-10-21','2026-10-21',$3,$4,1)`,
        [accountId, cat, ctx.userId, loanId],
      ),
    ).rejects.toThrow();
  });
});
