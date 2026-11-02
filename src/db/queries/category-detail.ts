/**
 * Detalhe de uma categoria no mês (D75): a lista que soma EXATAMENTE a fatia do gráfico.
 * Cada seção espelha uma parcela da fórmula em reports.ts (grossSpend / monthlySpend), com as mesmas condições,
 * mas devolve as linhas em vez da soma; tests/acceptance/category-detail.test.ts confere que a soma bate.
 * Categoria-mãe inclui as subcategorias (D74).
 *
 * SQL escrito à mão com aliases explícitos (ver CLAUDE.md sobre subconsultas no Drizzle).
 */
import { sql, type SQL } from 'drizzle-orm';
import { categoryChangeBlock } from '@/domain/categories';
import type { ISODate } from '@/domain/dates';
import type { Cents } from '@/domain/money';
import { PAYMENT_METHOD_LABEL } from '@/lib/labels';
import { centsFromDb } from '@/server/context';
import type { AnyDB } from '../client';
import {
  accountSide,
  ADJUSTMENTS_KEY,
  anyFilter,
  CASH_DATE_SQL,
  cardSide,
  grossSide,
  NO_CATEGORY_KEY,
  personFilters,
  rollupSql,
  rows,
  type ReportFilters,
} from './reports';

export type CategoryLine = {
  /** chave única da linha (uma compra em 10x aparece em várias linhas no Mensal) */
  key: string;
  date: ISODate;
  description: string;
  /** assinado: estorno é negativo */
  amountCents: Cents;
  /** meio, cartão, parcela… */
  detail: string;
  /** o lançamento cuja categoria vale para a linha; null = ajuste de fatura (sem categoria) */
  transactionId: string | null;
  /** categoria do lançamento (a própria categoria ou uma subcategoria dela) */
  categoryId: string | null;
  version: number | null;
  planId: string | null;
  recurringTemplateId: string | null;
  /** por que a categoria não pode ser trocada (null = pode) */
  lockedReason: string | null;
};

type Raw = {
  id: string;
  description: string;
  d: string;
  a: string;
  tid: string | null;
  cat: string | null;
  version: number | null;
  kind: string | null;
  pm: string | null;
  card_name: string | null;
  loan_id: string | null;
  wallet_id: string | null;
  tpl: string | null;
  plan_id: string | null;
  inst_count: number | null;
};

/** O lançamento pertence à categoria `key`? (mesma chave dos gráficos; a mãe inclui as filhas) */
function matchKey(key: string, categoryCol: string): SQL {
  if (key === NO_CATEGORY_KEY) return sql` and ${sql.raw(categoryCol)} is null`;
  return sql` and ${sql.raw(rollupSql(categoryCol))} = ${key}::uuid`;
}

const COLUMNS = sql`t.id as tid, t.category_id as cat, t.version as version, t.kind as kind, t.payment_method as pm,
  t.loan_id as loan_id, t.benefit_wallet_id as wallet_id, t.recurring_template_id as tpl`;

function toLine(r: Raw, extra: { key: string; detail: string; amountSign?: 1 | -1 }): CategoryLine {
  return {
    key: extra.key,
    date: r.d,
    description: r.description,
    amountCents: (extra.amountSign ?? 1) * centsFromDb(r.a),
    detail: extra.detail,
    transactionId: r.tid,
    categoryId: r.cat,
    version: r.version,
    planId: r.plan_id,
    recurringTemplateId: r.tpl,
    lockedReason: r.tid
      ? categoryChangeBlock({ kind: r.kind ?? 'EXPENSE', loanId: r.loan_id, benefitWalletId: r.wallet_id })
      : 'Ajuste da fatura: não tem categoria.',
  };
}

const methodText = (r: Raw) =>
  r.card_name
    ? `${r.card_name}${r.inst_count && r.inst_count > 1 ? ` · ${r.inst_count}x` : ''}`
    : r.wallet_id
      ? PAYMENT_METHOD_LABEL.BENEFIT_CARD!
      : (PAYMENT_METHOD_LABEL[r.pm ?? ''] ?? '');
const withFixed = (r: Raw, text: string) => (r.tpl ? `${text} · fixo` : text);

/**
 * Linhas de uma categoria no intervalo. `key` é a chave do gráfico: id da categoria (mãe), 'sem-categoria' ou
 * 'ajustes' (ajustes de fatura, só no Mensal). Mais recentes primeiro.
 */
export async function categoryLines(
  db: AnyDB,
  view: 'bruto' | 'mensal',
  from: ISODate,
  to: ISODate,
  key: string,
  f: ReportFilters = {},
): Promise<CategoryLine[]> {
  const out: CategoryLine[] = [];
  if (key === ADJUSTMENTS_KEY && view === 'bruto') return out;
  const real = key !== ADJUSTMENTS_KEY;

  if (view === 'bruto') {
    const purchases = await rows<Raw>(
      db,
      sql`select t.id, t.description, t.transaction_date::text as d, t.amount_cents as a, ${COLUMNS},
                 cc.name as card_name, p.id as plan_id, p.installment_count as inst_count
          from transactions t
          left join credit_cards cc on cc.id = t.credit_card_id
          left join installment_plans p on p.transaction_id = t.id
          where t.kind = 'EXPENSE' and t.status not in ('CANCELLED', 'ANTICIPATED') and t.deleted_at is null and t.source <> 'ONBOARDING'
            and t.transaction_date between ${from} and ${to}${personFilters(f, 't')}${grossSide(f)}${matchKey(key, 't.category_id')}`,
    );
    for (const r of purchases) out.push(toLine(r, { key: `c-${r.id}`, detail: withFixed(r, methodText(r)) }));
    const refunds = await rows<Raw>(
      db,
      sql`select r.id, 'Estorno: ' || t.description as description, r.refund_date::text as d, r.amount_cents as a, ${COLUMNS},
                 cc.name as card_name, r.installment_plan_id as plan_id, null::int as inst_count
          from refund_records r
          join transactions t on t.id = r.transaction_id
          left join credit_cards cc on cc.id = t.credit_card_id
          where r.refund_date between ${from} and ${to}${personFilters(f, 't')}${grossSide(f)}${matchKey(key, 't.category_id')}`,
    );
    for (const r of refunds)
      out.push(toLine(r, { key: `r-${r.id}`, detail: `Estorno · ${methodText(r)}`, amountSign: -1 }));
  } else {
    if (real) {
      const account = await rows<Raw>(
        db,
        sql`select t.id, t.description, (${sql.raw(CASH_DATE_SQL)})::text as d, t.amount_cents as a, ${COLUMNS},
                   null::text as card_name, null::uuid as plan_id, null::int as inst_count
            from transactions t
            where t.kind = 'EXPENSE' and t.bank_account_id is not null and t.status not in ('CANCELLED', 'ANTICIPATED') and t.deleted_at is null
              and ${sql.raw(CASH_DATE_SQL)} between ${from} and ${to}${personFilters(f, 't')}${accountSide(f, 't')}${matchKey(key, 't.category_id')}`,
      );
      for (const r of account) out.push(toLine(r, { key: `a-${r.id}`, detail: withFixed(r, methodText(r)) }));
      const benefit = await rows<Raw>(
        db,
        sql`select t.id, t.description, t.posted_date::text as d, t.amount_cents as a, ${COLUMNS},
                   null::text as card_name, null::uuid as plan_id, null::int as inst_count
            from transactions t
            where t.kind = 'EXPENSE' and t.benefit_wallet_id is not null and t.status = 'POSTED' and t.deleted_at is null
              and t.posted_date between ${from} and ${to}${personFilters(f, 't')}${accountSide(f, 't')}${matchKey(key, 't.category_id')}`,
      );
      for (const r of benefit) out.push(toLine(r, { key: `b-${r.id}`, detail: methodText(r) }));
    }
    // itens de fatura: parcela de compra com plano pertence à categoria da compra; sem plano é ajuste
    const items = await rows<Raw>(
      db,
      sql`select i.id, i.description, v.due_date::text as d, i.amount_cents as a, ${COLUMNS},
                 cc.name as card_name, i.installment_plan_id as plan_id, p.installment_count as inst_count
          from invoice_items i
          join invoices v on v.id = i.invoice_id
          join credit_cards cc on cc.id = i.credit_card_id
          left join installment_plans p on p.id = i.installment_plan_id
          left join transactions t on t.id = p.transaction_id
          where i.status = 'ACTIVE' and v.due_date between ${from} and ${to}
            ${anyFilter(f) ? sql`and t.id is not null` : sql``}${personFilters(f, 't')}${cardSide(f, 'i.credit_card_id')}
            ${real ? sql`and i.installment_plan_id is not null${matchKey(key, 't.category_id')}` : sql`and i.installment_plan_id is null`}`,
    );
    for (const r of items)
      out.push(
        toLine(r, {
          key: `i-${r.id}`,
          detail: `Fatura ${r.card_name} · vence ${r.d.slice(8, 10)}/${r.d.slice(5, 7)}`,
        }),
      );
    if (real) {
      const anticipations = await rows<Raw>(
        db,
        sql`select a.id, a.description, a.posted_date::text as d, a.amount_cents as a, ${COLUMNS},
                   cc.name as card_name, p.id as plan_id, p.installment_count as inst_count
            from transactions a
            join anticipation_records ar on ar.payment_transaction_id = a.id
            join installment_plans p on p.id = ar.installment_plan_id
            join transactions t on t.id = p.transaction_id
            left join credit_cards cc on cc.id = p.credit_card_id
            where a.kind = 'ANTICIPATION_PAYMENT' and a.status = 'POSTED' and a.deleted_at is null
              and a.posted_date between ${from} and ${to}${personFilters(f, 't')}${cardSide(f, 'p.credit_card_id')}${matchKey(key, 't.category_id')}`,
      );
      for (const r of anticipations)
        out.push(toLine(r, { key: `n-${r.id}`, detail: `Antecipação · ${methodText(r)}` }));
    }
  }
  return out.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? 1 : -1));
}
