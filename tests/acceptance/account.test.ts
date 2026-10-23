/**
 * Fase 2 — conta principal, fixos/recorrentes e conferência, contra Postgres real (PGlite).
 * O saldo de produção (getAccountBalance) é comparado com a fórmula de referência do card-ledger.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { getAccountBalance } from '@/db/queries/balance';
import { cashSummary, projection } from '@/db/queries/reports';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { createCheckpoint } from '@/server/checkpoints';
import type { ServiceCtx } from '@/server/context';
import { confirmPayment, createEntry, removeEntry, revertPayment, updateEntry } from '@/server/entries';
import {
  changeTemplateFrom,
  createTemplate,
  deleteTemplate,
  endTemplate,
  generateOccurrences,
} from '@/server/recurring';
import type { EntryInput, TemplateInput } from '@/server/schemas';
import { freshDb } from './helpers';

const env = {
  SEED_USER1_NAME: 'Eduardo',
  SEED_USER1_EMAIL: 'eduardo@example.com',
  SEED_USER1_PASSWORD: 'senha-do-eduardo',
  SEED_USER2_NAME: 'Viviane',
  SEED_USER2_EMAIL: 'viviane@example.com',
  SEED_USER2_PASSWORD: 'senha-da-viviane',
  SEED_OPENING_BALANCE: '5.000,00',
  SEED_OPENING_BALANCE_DATE: '2026-10-01',
};

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let accountId: string;
let mercado: string; // categoria de despesa
let salario: string; // categoria de receita
let viviane: string;

const q = async <T>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;

/** Fórmula de referência (copiada de tests/acceptance/card-ledger.test.ts). */
const referenceBalance = async () =>
  Number(
    (
      await q<{ v: string }>(
        `select a.opening_balance_cents + coalesce(sum(case
          when t.kind in ('INCOME','TRANSFER_IN','ADJUSTMENT_IN') then t.amount_cents
          else -t.amount_cents end), 0) as v
        from bank_accounts a
        left join transactions t on t.bank_account_id = a.id and t.status = 'POSTED' and t.deleted_at is null
        where a.id = $1 group by a.id`,
        [accountId],
      )
    )[0]!.v,
  );

const balance = async () => {
  const prod = await getAccountBalance(db, accountId, '2100-01-01');
  expect(prod).toBe(await referenceBalance());
  return prod;
};

const expense = (over: Partial<EntryInput> = {}): EntryInput => ({
  kind: 'EXPENSE',
  amount: 12_345,
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

const occurrences = (templateId?: string) =>
  q<{
    id: string;
    month: string;
    status: string;
    amount: string;
    version: number;
    template: string;
    due: string;
  }>(
    `select id, occurrence_month::text as month, status, amount_cents::text as amount, version,
            recurring_template_id as template, due_date::text as due
     from transactions where recurring_template_id is not null and deleted_at is null
     ${templateId ? `and recurring_template_id = '${templateId}'` : ''} order by occurrence_month`,
  );

const version = async (id: string) =>
  (await q<{ version: number }>(`select version from transactions where id = $1`, [id]))[0]!.version;

beforeEach(async () => {
  ({ pg, db } = await freshDb());
  await seed(db, seedConfigFromEnv(env));
  accountId = (await q<{ id: string }>(`select id from bank_accounts`))[0]!.id;
  mercado = (await q<{ id: string }>(`select id from categories where name = 'Mercado'`))[0]!.id;
  salario = (await q<{ id: string }>(`select id from categories where name = 'Salário CLT'`))[0]!.id;
  const eduardo = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  viviane = (await q<{ id: string }>(`select id from users where name = 'Viviane'`))[0]!.id;
  ctx = { db, userId: eduardo, today: '2026-10-17' };
});

describe('lançamentos à vista', () => {
  it('saldo derivado = inicial + receitas − despesas, igual à fórmula de referência', async () => {
    expect(await balance()).toBe(500_000);
    await createEntry(ctx, expense());
    await createEntry(
      ctx,
      expense({ kind: 'INCOME', amount: 1_000_000, categoryId: salario, description: 'Salário' }),
    );
    expect(await balance()).toBe(500_000 - 12_345 + 1_000_000);
  });

  it('grava quem lançou, beneficiário e audit_log', async () => {
    const { id } = await createEntry({ ...ctx, userId: viviane }, expense({ beneficiaryUserId: viviane }));
    const [row] = await q<{ created_by_user_id: string; beneficiary_user_id: string; source: string }>(
      `select created_by_user_id, beneficiary_user_id, source from transactions where id = $1`,
      [id],
    );
    expect(row).toEqual({ created_by_user_id: viviane, beneficiary_user_id: viviane, source: 'MANUAL' });
    expect(await q(`select 1 from audit_log where entity_id = $1 and action = 'CREATE'`, [id])).toHaveLength(
      1,
    );
  });

  it('D18: bloqueia data anterior ao saldo inicial', async () => {
    await expect(createEntry(ctx, expense({ date: '2026-09-30' }))).rejects.toThrow('início do controle');
  });

  it('categoria precisa combinar com o tipo', async () => {
    await expect(createEntry(ctx, expense({ categoryId: salario }))).rejects.toThrow('categoria de despesa');
  });

  it('edição com lock otimista e exclusão lógica', async () => {
    const { id } = await createEntry(ctx, expense());
    await updateEntry(ctx, id, 1, expense({ amount: 10_000 }));
    expect(await balance()).toBe(490_000);
    await expect(updateEntry(ctx, id, 1, expense({ amount: 1 }))).rejects.toThrow(
      'alterado por outra pessoa',
    );
    await removeEntry(ctx, id, 2);
    expect(await balance()).toBe(500_000);
    const [row] = await q<{ deleted: boolean }>(
      `select deleted_at is not null deleted from transactions where id = $1`,
      [id],
    );
    expect(row!.deleted).toBe(true); // nunca apaga fisicamente
  });
});

describe('fixos e recorrentes', () => {
  it('gera retroativo até o mês atual (D17), dia 31 vira fim do mês, e é idempotente', async () => {
    const { id } = await createTemplate({ ...ctx, today: '2027-02-10' }, template({ dayOfMonth: 31 }));
    const occ = await occurrences(id);
    expect(occ.map((o) => [o.month, o.due, o.status])).toEqual([
      ['2026-10-01', '2026-10-31', 'PENDING'],
      ['2026-11-01', '2026-11-30', 'PENDING'],
      ['2026-12-01', '2026-12-31', 'PENDING'],
      ['2027-01-01', '2027-01-31', 'PENDING'],
      ['2027-02-01', '2027-02-28', 'PENDING'],
    ]);
    expect(await generateOccurrences(db, '2027-02-10')).toBe(0);
    await Promise.all([generateOccurrences(db, '2027-02-10'), generateOccurrences(db, '2027-02-10')]);
    expect(await occurrences(id)).toHaveLength(5);
    expect(await balance()).toBe(500_000); // pendente não mexe no saldo
  });

  it('confirmar pagamento com valor real e estornar a baixa (D16)', async () => {
    const { id: tplId } = await createTemplate(
      ctx,
      template({ type: 'RECURRING_VARIABLE', description: 'Luz', amount: 25_000 }),
    );
    const [occ] = await occurrences(tplId);
    await confirmPayment(ctx, occ!.id, occ!.version, { date: '2026-10-12', amount: 27_390 });
    expect(await balance()).toBe(500_000 - 27_390);
    const [paid] = await q<{ status: string; amount: string; estimated: string; posted: string }>(
      `select status, amount_cents::text amount, estimated_amount_cents::text estimated, posted_date::text posted
       from transactions where id = $1`,
      [occ!.id],
    );
    expect(paid).toEqual({ status: 'POSTED', amount: '27390', estimated: '25000', posted: '2026-10-12' });
    await expect(
      confirmPayment(ctx, occ!.id, await version(occ!.id), { date: '2026-10-12', amount: 1 }),
    ).rejects.toThrow('não está pendente');

    await revertPayment(ctx, occ!.id, await version(occ!.id));
    const [back] = await q<{
      status: string;
      amount: string;
      estimated: string | null;
      posted: string | null;
    }>(
      `select status, amount_cents::text amount, estimated_amount_cents::text estimated, posted_date::text posted
       from transactions where id = $1`,
      [occ!.id],
    );
    expect(back).toEqual({ status: 'PENDING', amount: '25000', estimated: null, posted: null });
    expect(await balance()).toBe(500_000);
  });

  it('cancelar uma ocorrência: a geração não a recria', async () => {
    const { id: tplId } = await createTemplate(ctx, template());
    const [occ] = await occurrences(tplId);
    await removeEntry(ctx, occ!.id, occ!.version);
    expect(await generateOccurrences(db, ctx.today)).toBe(0);
    expect((await occurrences(tplId)).map((o) => o.status)).toEqual(['CANCELLED']);
  });

  it('alterar a partir de (D21): pagas ficam, pendentes seguem o novo valor, uma conta por mês', async () => {
    const jan = { ...ctx, today: '2027-01-05' };
    const { id: oldId } = await createTemplate(jan, template());
    const [oct, nov] = await occurrences(oldId);
    await confirmPayment(jan, oct!.id, oct!.version, { date: '2026-10-10', amount: 200_000 });
    await confirmPayment(jan, nov!.id, nov!.version, { date: '2026-11-10', amount: 200_000 });

    const { id: newId } = await changeTemplateFrom(jan, oldId, {
      type: 'FIXED',
      description: 'Aluguel reajustado',
      categoryId: mercado,
      amount: 215_000,
      dayOfMonth: 5,
      paymentMethod: 'BOLETO',
      creditCardId: null,
      beneficiaryUserId: null,
      effectiveMonth: '2026-11-01',
    });
    expect(newId).not.toBe(oldId);

    const all = await occurrences();
    expect(
      all.map((o) => [o.month, o.status, o.amount, o.template === newId ? 'novo' : 'antigo', o.due]),
    ).toEqual([
      ['2026-10-01', 'POSTED', '200000', 'antigo', '2026-10-10'],
      ['2026-11-01', 'POSTED', '200000', 'novo', '2026-11-10'], // paga: valor e data intactos
      ['2026-12-01', 'PENDING', '215000', 'novo', '2026-12-05'],
      ['2027-01-01', 'PENDING', '215000', 'novo', '2027-01-05'],
    ]);
    const [old] = await q<{ end_month: string }>(
      `select end_month::text from recurring_templates where id = $1`,
      [oldId],
    );
    expect(old!.end_month).toBe('2026-10-01');
    expect(await generateOccurrences(db, '2027-01-05')).toBe(0);
  });

  it('alterar a partir do próprio início edita no lugar', async () => {
    const { id } = await createTemplate(ctx, template());
    const r = await changeTemplateFrom(ctx, id, {
      ...template(),
      amount: 1_000,
      effectiveMonth: '2026-10-01',
    });
    expect(r.id).toBe(id);
    expect((await occurrences(id)).map((o) => o.amount)).toEqual(['1000']);
  });

  it('encerrar cancela as pendentes depois do último mês', async () => {
    const feb = { ...ctx, today: '2027-02-01' };
    const { id } = await createTemplate(feb, template());
    await endTemplate(feb, id, '2026-12-01');
    expect((await occurrences(id)).map((o) => [o.month, o.status])).toEqual([
      ['2026-10-01', 'PENDING'],
      ['2026-11-01', 'PENDING'],
      ['2026-12-01', 'PENDING'],
      ['2027-01-01', 'CANCELLED'],
      ['2027-02-01', 'CANCELLED'],
    ]);
    expect(await generateOccurrences(db, '2027-05-01')).toBe(0);
  });

  it('excluir o fixo (D63): some com o modelo e as contas não pagas; as pagas ficam e o saldo não muda', async () => {
    const feb = { ...ctx, today: '2027-02-01' };
    const { id } = await createTemplate(feb, template());
    const [oct, nov, dez] = await occurrences(id);
    await confirmPayment(feb, oct!.id, oct!.version, { date: '2026-10-10', amount: 200_000 });
    await removeEntry(feb, dez!.id, dez!.version); // uma cancelada (não vai ter esse mês)
    const saldoAntes = await balance();

    const r = await deleteTemplate(feb, id);
    expect(r).toEqual({ removed: 4, kept: 1 }); // nov, jan, fev pendentes + dez cancelada; out paga

    expect(await q(`select 1 from recurring_templates where id = $1`, [id])).toHaveLength(0);
    const rest = await q<{ status: string; tpl: string | null; month: string | null }>(
      `select status, recurring_template_id tpl, occurrence_month::text as month from transactions where description = $1 and deleted_at is null`,
      [template().description],
    );
    expect(rest).toEqual([{ status: 'POSTED', tpl: null, month: null }]);
    expect(await balance()).toBe(saldoAntes);
    expect(nov).toBeDefined();
    // a geração não recria nada
    expect(await generateOccurrences(db, '2027-05-01')).toBe(0);
    // e não dá para excluir duas vezes
    await expect(deleteTemplate(feb, id)).rejects.toThrow('não encontrado');
  });

  it('receita prevista gera ocorrência de entrada', async () => {
    const { id } = await createTemplate(
      ctx,
      template({
        direction: 'INCOME',
        categoryId: salario,
        description: 'Salário CLT',
        amount: 800_000,
        dayOfMonth: 5,
      }),
    );
    const [occ] = await occurrences(id);
    await confirmPayment(ctx, occ!.id, occ!.version, { date: '2026-10-05', amount: 800_000 });
    expect(await balance()).toBe(1_300_000);
  });
});

describe('conferência de saldo (D20)', () => {
  it('ajuste faz o saldo calculado na data bater com o banco', async () => {
    await createEntry(ctx, expense({ date: '2026-10-05', amount: 10_000 }));
    await createEntry(ctx, expense({ date: '2026-10-16', amount: 5_000 })); // depois da data conferida
    const r = await createCheckpoint(ctx, {
      date: '2026-10-10',
      statementBalance: 489_950,
      applyAdjustment: true,
    });
    expect(r.computedCents).toBe(490_000);
    expect(r.adjustmentTransactionId).not.toBeNull();
    expect(await getAccountBalance(db, accountId, '2026-10-10')).toBe(489_950);
    expect(await balance()).toBe(489_950 - 5_000);
    await expect(
      createCheckpoint(ctx, { date: '2026-10-10', statementBalance: 1, applyAdjustment: false }),
    ).rejects.toThrow('Já existe uma conferência');
  });

  it('sem ajuste: só registra a divergência', async () => {
    const r = await createCheckpoint(ctx, {
      date: '2026-10-17',
      statementBalance: 400_000,
      applyAdjustment: false,
    });
    expect(r.adjustmentTransactionId).toBeNull();
    expect(await balance()).toBe(500_000);
  });

  it('banco bate: nenhum lançamento de ajuste', async () => {
    const r = await createCheckpoint(ctx, {
      date: '2026-10-17',
      statementBalance: 500_000,
      applyAdjustment: true,
    });
    expect(r.adjustmentTransactionId).toBeNull();
  });
});

describe('lançamento com data futura é agendado (D67)', () => {
  // hoje = 17/10/2026; saldo inicial 5.000,00 em 01/10
  const TODAY = '2026-10-17';
  const at = (date: string) => getAccountBalance(db, accountId, date);

  it('receita futura não entra no saldo de hoje, nem no "recebido"; entra sozinha no dia', async () => {
    await createEntry(
      ctx,
      expense({
        kind: 'INCOME',
        amount: 250_000,
        categoryId: salario,
        description: 'Freela',
        date: '2026-10-25',
      }),
    );
    expect(await at(TODAY)).toBe(500_000); // saldo atual: só o que já aconteceu
    expect(await at('2026-10-24')).toBe(500_000);
    expect(await at('2026-10-25')).toBe(750_000); // no dia, entra sem dar baixa
    expect(await at('2026-11-30')).toBe(750_000);

    const s = (await cashSummary(db, '2026-10-01', TODAY))!;
    expect(s.balanceCents).toBe(500_000);
    expect(s.incomeReceivedCents).toBe(0); // ainda não recebido
    expect(s.incomePendingCents).toBe(250_000); // a receber
    expect(s.endOfMonthCents).toBe(750_000); // a previsão do fim do mês já conta com ela
  });

  it('despesa futura também espera o dia: não sai do saldo e aparece como a pagar', async () => {
    await createEntry(ctx, expense({ amount: 80_000, date: '2026-10-28', description: 'Dentista' }));
    expect(await at(TODAY)).toBe(500_000);
    expect(await at('2026-10-28')).toBe(420_000);
    const s = (await cashSummary(db, '2026-10-01', TODAY))!;
    expect(s.outPaidCents).toBe(0);
    expect(s.outPendingCents).toBe(80_000);
    expect(s.endOfMonthCents).toBe(420_000);
  });

  it('lançamento de hoje ou de ontem conta como atual', async () => {
    await createEntry(ctx, expense({ amount: 10_000, date: TODAY, description: 'Hoje' }));
    await createEntry(ctx, expense({ amount: 5_000, date: '2026-10-16', description: 'Ontem' }));
    expect(await at(TODAY)).toBe(500_000 - 15_000);
    const s = (await cashSummary(db, '2026-10-01', TODAY))!;
    expect(s.outPaidCents).toBe(15_000);
    expect(s.outPendingCents).toBe(0);
  });

  it('agendado em mês futuro entra na projeção desse mês, e não na do mês atual', async () => {
    await createEntry(
      ctx,
      expense({
        kind: 'INCOME',
        amount: 300_000,
        categoryId: salario,
        description: 'Bônus',
        date: '2026-12-10',
      }),
    );
    await createEntry(ctx, expense({ amount: 70_000, date: '2026-12-15', description: 'Viagem' }));
    expect(await at(TODAY)).toBe(500_000);
    const rows = await projection(db, TODAY, '2026-12-01');
    const nov = rows.find((r) => r.month === '2026-11-01')!;
    const dec = rows.find((r) => r.month === '2026-12-01')!;
    expect(nov.incomeCents).toBe(0);
    expect(dec.incomeCents).toBe(300_000);
    expect(dec.scheduledOutCents).toBe(70_000);
    expect(dec.resultCents).toBe(230_000);
    expect(dec.estimatedBalanceCents).toBe(500_000 + 230_000);
  });

  it('a conferência de saldo de uma data compara só o que tinha acontecido até ela', async () => {
    await createEntry(ctx, expense({ amount: 99_000, date: '2026-10-30', description: 'Futuro' }));
    expect(await at('2026-10-17')).toBe(500_000);
  });
});
