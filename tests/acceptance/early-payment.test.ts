/**
 * Pagamento antecipado (D70), Postgres real (PGlite): conta que vence num mês e é paga num mês ANTERIOR.
 *  - a conta original fica ANTICIPATED (de registro, fora das somas) e o dinheiro vai para um lançamento novo,
 *    no mês do pagamento, ligado a ela, com desconto/acréscimo = previsto − pago;
 *  - o saldo baixa na data do pagamento; estornar/excluir o pagamento devolve a conta para "a pagar";
 *  - dentro do mesmo mês a baixa segue como sempre (uma linha só).
 * Caso real: "Empréstimo Shopee 1/3", R$ 217,80, vencia em 01/11 e foi paga em 30/10 por R$ 215,93.
 */
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyDB } from '@/db/client';
import { getAccountBalance } from '@/db/queries/balance';
import { getAnticipationLink, getEntry, listEntries } from '@/db/queries/entries';
import { cashSummary, grossSpend, monthlySpend, total } from '@/db/queries/reports';
import { summaryDetail } from '@/db/queries/summary-detail';
import { seed, seedConfigFromEnv } from '@/db/seed';
import { createBenefitCard, deleteBenefitSpend } from '@/server/benefits';
import { type ServiceCtx } from '@/server/context';
import { confirmPayment, createEntry, removeEntry, revertPayment, updateEntry } from '@/server/entries';
import { createTemplate, generateOccurrences } from '@/server/recurring';
import type { EntryInput } from '@/server/schemas';
import { freshDb } from './helpers';

const TODAY = '2026-10-30';

let pg: PGlite;
let db: AnyDB;
let ctx: ServiceCtx;
let accountId: string;
let contas: string;

const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pg.query<T>(s, p)).rows;
const balance = (asOf = TODAY) => getAccountBalance(db, accountId, asOf);
const gross = async (from: string, to: string) => total(await grossSpend(db, from, to, 'category'));
const monthly = async (from: string, to: string) => total(await monthlySpend(db, from, to, 'category'));

const expense = (over: Partial<EntryInput> = {}): EntryInput => ({
  kind: 'EXPENSE',
  amount: 21_780,
  description: 'Empréstimo Shopee 1/3',
  categoryId: contas,
  paymentMethod: 'PIX',
  date: '2026-11-01',
  beneficiaryUserId: null,
  notes: null,
  paid: false,
  ...over,
});

type Row = {
  id: string;
  status: string;
  amount: string;
  estimated: string | null;
  due: string | null;
  posted: string | null;
  tdate: string;
  anticipates: string | null;
  deleted: boolean;
  version: number;
};
const row = async (id: string) =>
  (
    await q<Row>(
      `select id, status, amount_cents::text as amount, estimated_amount_cents::text as estimated,
              due_date::text as due, posted_date::text as posted, transaction_date::text as tdate,
              anticipates_transaction_id as anticipates, deleted_at is not null as deleted, version
       from transactions where id = $1`,
      [id],
    )
  )[0]!;
const paymentOf = async (parentId: string) =>
  (
    await q<{ id: string }>(
      `select id from transactions where anticipates_transaction_id = $1 and deleted_at is null`,
      [parentId],
    )
  )[0]?.id;

/** A Shopee: lançada a pagar para 01/11 e paga em 30/10 com desconto. */
async function shopeePaidEarly(amount = 21_593) {
  const { id: parentId } = await createEntry(ctx, expense());
  const { id: paymentId } = await confirmPayment(ctx, parentId, (await row(parentId)).version, {
    amount,
    date: TODAY,
  });
  return { parentId, paymentId };
}

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
      SEED_OPENING_BALANCE: '500,00',
      SEED_OPENING_BALANCE_DATE: '2026-10-01',
    }),
  );
  accountId = (await q<{ id: string }>(`select id from bank_accounts`))[0]!.id;
  contas = (await q<{ id: string }>(`select id from categories where name = 'Contas da casa'`))[0]!.id;
  const eduardo = (await q<{ id: string }>(`select id from users where name = 'Eduardo'`))[0]!.id;
  ctx = { db, userId: eduardo, today: TODAY };
});

describe('pagar em mês anterior ao do vencimento', () => {
  it('a conta original fica "paga antes", intacta; o dinheiro vai para um pagamento ligado, em 30/10', async () => {
    const { parentId, paymentId } = await shopeePaidEarly();
    expect(await row(parentId)).toMatchObject({
      status: 'ANTICIPATED',
      amount: '21780',
      due: '2026-11-01',
      posted: null,
      anticipates: null,
    });
    expect(await row(paymentId)).toMatchObject({
      status: 'POSTED',
      amount: '21593',
      estimated: '21780', // o previsto: a diferença é o desconto
      due: null,
      posted: TODAY,
      tdate: TODAY,
      anticipates: parentId,
    });
  });

  it('o saldo baixa hoje, pelo valor pago', async () => {
    await shopeePaidEarly();
    expect(await balance()).toBe(50_000 - 21_593);
  });

  it('outubro conta o pagamento; novembro não conta mais a conta original (nos dois gastos)', async () => {
    await shopeePaidEarly();
    expect(await gross('2026-10-01', '2026-10-31')).toBe(21_593);
    expect(await monthly('2026-10-01', '2026-10-31')).toBe(21_593);
    expect(await gross('2026-11-01', '2026-11-30')).toBe(0);
    expect(await monthly('2026-11-01', '2026-11-30')).toBe(0);
  });

  it('Home: outubro mostra o que saiu; novembro não tem mais nada a pagar da conta', async () => {
    await shopeePaidEarly();
    const oct = (await cashSummary(db, '2026-10-01', TODAY))!;
    expect(oct.outPaidCents).toBe(21_593);
    expect(oct.outPendingCents).toBe(0);
    const nov = (await cashSummary(db, '2026-11-01', TODAY))!;
    expect(nov.outPaidCents).toBe(0);
    expect(nov.outPendingCents).toBe(0);
    expect((await summaryDetail(db, 'a-pagar', '2026-11-01', TODAY)).entries).toHaveLength(0);
    const saiu = await summaryDetail(db, 'saiu', '2026-10-01', TODAY);
    expect(saiu.entries.map((e) => e.description)).toEqual(['Empréstimo Shopee 1/3']);
    expect(saiu.totalCents).toBe(oct.outPaidCents);
  });

  it('as duas linhas aparecem nos lançamentos, cada uma no seu mês; só o pagamento soma', async () => {
    const { parentId, paymentId } = await shopeePaidEarly();
    const oct = await listEntries(db, { month: '2026-10-01' });
    const nov = await listEntries(db, { month: '2026-11-01' });
    expect(oct.filter((e) => e.description.includes('Shopee')).map((e) => e.id)).toEqual([paymentId]);
    expect(nov.filter((e) => e.description.includes('Shopee')).map((e) => [e.id, e.status])).toEqual([
      [parentId, 'ANTICIPATED'],
    ]);
  });

  it('o vínculo nos dois sentidos, com o desconto calculado (R$ 217,80 − R$ 215,93 = R$ 1,87)', async () => {
    const { parentId, paymentId } = await shopeePaidEarly();
    const parent = (await getEntry(db, parentId))!;
    const payment = (await getEntry(db, paymentId))!;
    expect(await getAnticipationLink(db, parent)).toMatchObject({
      role: 'original',
      other: { id: paymentId, amountCents: 21_593, postedDate: TODAY },
    });
    expect(await getAnticipationLink(db, payment)).toMatchObject({
      role: 'payment',
      other: { id: parentId, dueDate: '2026-11-01', amountCents: 21_780 },
    });
    expect(payment.estimatedAmountCents! - payment.amountCents).toBe(187);
  });

  it('pagou a mais (juros): vira acréscimo e o saldo baixa o valor pago', async () => {
    const { paymentId } = await shopeePaidEarly(22_000);
    expect(await row(paymentId)).toMatchObject({ amount: '22000', estimated: '21780' });
    expect(await balance()).toBe(50_000 - 22_000);
    expect(await gross('2026-10-01', '2026-10-31')).toBe(22_000);
  });

  it('gera o histórico: a conta (ANTICIPATE) e o pagamento (CREATE) no audit_log', async () => {
    const { parentId, paymentId } = await shopeePaidEarly();
    const parentLog = await q<{ action: string }>(
      `select action from audit_log where entity_id = $1 order by id`,
      [parentId],
    );
    expect(parentLog.map((l) => l.action)).toEqual(['CREATE', 'ANTICIPATE']);
    const paymentLog = await q<{ action: string }>(`select action from audit_log where entity_id = $1`, [
      paymentId,
    ]);
    expect(paymentLog.map((l) => l.action)).toEqual(['CREATE']);
  });

  it('sem saldo, o aporte cobre a diferença e fica ligado ao pagamento (não à conta original)', async () => {
    const { id: parentId } = await createEntry(ctx, expense({ amount: 90_000 }));
    const v = (await row(parentId)).version;
    await expect(confirmPayment(ctx, parentId, v, { amount: 90_000, date: TODAY })).rejects.toThrow('faltam');
    const { id: paymentId } = await confirmPayment(ctx, parentId, v, {
      amount: 90_000,
      date: TODAY,
      fundingAmount: 40_000,
      fundingNote: 'Poupança',
    });
    const funding = await q<{ funding_for_transaction_id: string }>(
      `select funding_for_transaction_id from transactions where funding_for_transaction_id is not null`,
    );
    expect(funding.map((f) => f.funding_for_transaction_id)).toEqual([paymentId]);
    expect(await balance()).toBe(50_000 + 40_000 - 90_000);
  });
});

describe('não antecipa', () => {
  it('pago no mesmo mês do vencimento (antes ou depois): uma linha só, como sempre', async () => {
    const { id } = await createEntry(ctx, expense({ date: '2026-10-31' }));
    const r = await confirmPayment(ctx, id, (await row(id)).version, { amount: 21_000, date: TODAY });
    expect(r.id).toBe(id);
    expect(await row(id)).toMatchObject({
      status: 'POSTED',
      amount: '21000',
      estimated: '21780',
      posted: TODAY,
    });
    expect(await q(`select 1 from transactions where anticipates_transaction_id is not null`)).toHaveLength(
      0,
    );
  });

  it('pago depois do vencimento (atraso): também como sempre', async () => {
    const { id } = await createEntry(ctx, expense({ date: '2026-10-17' }));
    await confirmPayment(ctx, id, (await row(id)).version, { amount: 21_780, date: TODAY });
    expect((await row(id)).status).toBe('POSTED');
  });
});

describe('desfazer o pagamento antecipado', () => {
  it('estornar o pagamento: a conta volta a pendente em 01/11 e o saldo volta', async () => {
    const { parentId, paymentId } = await shopeePaidEarly();
    await revertPayment(ctx, paymentId, (await row(paymentId)).version);
    expect(await row(parentId)).toMatchObject({ status: 'PENDING', amount: '21780', due: '2026-11-01' });
    expect((await row(paymentId)).deleted).toBe(true);
    expect(await balance()).toBe(50_000);
    expect(await gross('2026-10-01', '2026-10-31')).toBe(0);
    expect((await cashSummary(db, '2026-11-01', TODAY))!.outPendingCents).toBe(21_780);
  });

  it('dá para pagar de novo depois do estorno (um pagamento por conta)', async () => {
    const { parentId, paymentId } = await shopeePaidEarly();
    await revertPayment(ctx, paymentId, (await row(paymentId)).version);
    const again = await confirmPayment(ctx, parentId, (await row(parentId)).version, {
      amount: 21_593,
      date: TODAY,
    });
    expect(again.id).not.toBe(paymentId);
    expect(await balance()).toBe(50_000 - 21_593);
  });

  it('excluir o pagamento faz o mesmo que estornar', async () => {
    const { parentId, paymentId } = await shopeePaidEarly();
    await removeEntry(ctx, paymentId, (await row(paymentId)).version);
    expect((await row(parentId)).status).toBe('PENDING');
    expect(await balance()).toBe(50_000);
  });

  it('a conta original não pode ser editada, excluída nem estornada: o pagamento é que manda', async () => {
    const { parentId } = await shopeePaidEarly();
    const v = (await row(parentId)).version;
    await expect(removeEntry(ctx, parentId, v)).rejects.toThrow('paga antes do vencimento');
    await expect(revertPayment(ctx, parentId, v)).rejects.toThrow('paga antes do vencimento');
    await expect(updateEntry(ctx, parentId, v, expense({ amount: 1_000 }))).rejects.toThrow(
      'paga antes do vencimento',
    );
    expect((await row(parentId)).status).toBe('ANTICIPATED');
  });

  it('editar o pagamento mexe no valor/desconto e mantém o vínculo', async () => {
    const { paymentId, parentId } = await shopeePaidEarly();
    await updateEntry(
      ctx,
      paymentId,
      (await row(paymentId)).version,
      expense({ amount: 21_500, date: TODAY }),
    );
    expect(await row(paymentId)).toMatchObject({
      amount: '21500',
      estimated: '21780',
      anticipates: parentId,
    });
    expect(await balance()).toBe(50_000 - 21_500);
  });
});

describe('fixo e carteira', () => {
  it('conta de fixo paga antes: a geração não recria a ocorrência, e a projeção de novembro não a conta duas vezes', async () => {
    // o fixo vence dia 5; em 02/11 a ocorrência de novembro é gerada e a conta é registrada como paga em 30/10
    const fixo = { ...ctx, today: '2026-11-02' };
    await createTemplate(fixo, {
      type: 'FIXED',
      direction: 'EXPENSE',
      description: 'Internet fixa',
      categoryId: contas,
      amount: 10_000,
      dayOfMonth: 5,
      paymentMethod: 'BOLETO',
      creditCardId: null,
      startMonth: '2026-11-01',
      endMonth: null,
      beneficiaryUserId: null,
    });
    const [occ] = await q<{ id: string; version: number }>(
      `select id, version from transactions where recurring_template_id is not null`,
    );
    const { id: paymentId } = await confirmPayment(fixo, occ!.id, occ!.version, {
      amount: 9_500,
      date: '2026-10-30',
    });
    expect((await row(occ!.id)).status).toBe('ANTICIPATED');
    const count = async () => (await q<{ n: string }>(`select count(*)::text as n from transactions`))[0]!.n;
    const before = await count();
    expect(await generateOccurrences(db, '2026-11-02')).toBe(0);
    expect(await count()).toBe(before);
    // o pagamento não carrega o fixo (o par template/mês é único) e conta em outubro
    expect(
      await q(`select 1 from transactions where id = $1 and recurring_template_id is null`, [paymentId]),
    ).toHaveLength(1);
    expect(await monthly('2026-10-01', '2026-10-31')).toBe(9_500);
    expect(await monthly('2026-11-01', '2026-11-30')).toBe(0);
  });

  it('paga com a carteira do cartão de benefícios: sai da carteira, a conta fica; excluir reabre a conta', async () => {
    await createBenefitCard(ctx, {
      name: 'Multibenefícios',
      issuer: null,
      last4: null,
      creditRule: 'LAST_BUSINESS_DAY',
      creditDay: null,
      startMonth: '2026-11-01',
      wallets: [{ name: 'Multibenefícios', monthlyCredit: 150_000, openingBalance: 150_000 }],
    });
    const walletId = (await q<{ id: string }>(`select id from benefit_wallets limit 1`))[0]!.id;
    const { id: parentId } = await createEntry(ctx, expense({ amount: 12_000 }));
    const { id: paymentId } = await confirmPayment(ctx, parentId, (await row(parentId)).version, {
      amount: 11_900,
      date: TODAY,
      walletId,
    });
    expect((await row(parentId)).status).toBe('ANTICIPATED');
    const [p] = await q<{ wallet: string | null; bank: string | null }>(
      `select benefit_wallet_id as wallet, bank_account_id as bank from transactions where id = $1`,
      [paymentId],
    );
    expect(p).toEqual({ wallet: walletId, bank: null });
    expect(await balance()).toBe(50_000); // a conta não foi tocada
    expect(await monthly('2026-10-01', '2026-10-31')).toBe(11_900);
    expect(await gross('2026-11-01', '2026-11-30')).toBe(0);

    await deleteBenefitSpend(ctx, paymentId);
    expect((await row(parentId)).status).toBe('PENDING');
    expect(await paymentOf(parentId)).toBeUndefined();
  });
});
