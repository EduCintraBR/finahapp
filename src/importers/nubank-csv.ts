/**
 * CSV do Nubank (Fase 5), no mesmo formato interno do OFX para reaproveitar toda a revisão e a conciliação.
 *  - Conta: `Data,Valor,Identificador,Descrição` (dd/mm/aaaa, valor com sinal, Identificador = FITID do OFX).
 *  - Fatura: `date,title,amount` (às vezes com `category`); compra positiva, pagamento/estorno negativos.
 * As colunas são reconhecidas pelo nome. O CSV não traz período nem saldo: o período do cartão é escolhido na
 * tela, e a conta fica sem conferência de saldo.
 */
import { createHash } from 'node:crypto';
import { isISODate, type ISODate } from '@/domain/dates';
import { tryParseBRL } from '@/domain/money';
import { CsvError, findColumns, normalizeHeader, parseCsv } from './csv';
import type { OfxStatement, OfxTransaction } from './ofx';

function parseDate(raw: string, line: number): ISODate {
  const v = raw.trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  const iso = br ? `${br[3]}-${br[2]!.padStart(2, '0')}-${br[1]!.padStart(2, '0')}` : v.slice(0, 10);
  if (!isISODate(iso))
    throw new CsvError(`Linha ${line}: data inválida ("${v}"). Use dd/mm/aaaa ou aaaa-mm-dd.`);
  return iso;
}

function parseAmount(raw: string, line: number) {
  const r = tryParseBRL(raw);
  if (!r.ok) throw new CsvError(`Linha ${line}: valor inválido ("${raw.trim()}").`);
  return r.value;
}

/** FITID estável para linhas sem identificador: o mesmo arquivo (ou um que se sobreponha) gera as mesmas chaves. */
function stableId(counts: Map<string, number>, date: string, cents: number, memo: string) {
  const key = `${date}|${cents}|${memo.trim().toLowerCase()}`;
  const occurrence = counts.get(key) ?? 0;
  counts.set(key, occurrence + 1);
  return `csv-${createHash('sha1').update(`${key}|${occurrence}`).digest('hex').slice(0, 20)}`;
}

function bodyOf(text: string) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new CsvError('O CSV não tem nenhuma linha de lançamento.');
  return { header: rows[0]!, rows: rows.slice(1) };
}

const statement = (account: OfxStatement['account'], transactions: OfxTransaction[]): OfxStatement => ({
  account,
  accountId: null,
  currency: 'BRL',
  periodStart: null,
  periodEnd: null,
  ledgerBalanceCents: null,
  transactions,
});

export function parseNubankAccountCsv(text: string): OfxStatement {
  const { header, rows } = bodyOf(text);
  const names = header.map(normalizeHeader);
  if (names.includes('title') && !names.includes('identificador')) {
    throw new CsvError(
      'Este CSV parece ser de uma fatura de cartão (colunas date, title, amount). Importe-o pela tela do cartão.',
    );
  }
  const col = findColumns(header, {
    date: { names: ['data', 'date'], required: true },
    amount: { names: ['valor', 'amount'], required: true },
    memo: { names: ['descricao', 'description', 'historico', 'memo', 'title'], required: true },
    id: { names: ['identificador', 'id', 'codigo'], required: false },
  });
  const counts = new Map<string, number>();
  const transactions = rows.map((r, i): OfxTransaction => {
    const line = i + 2;
    const date = parseDate(r[col.date] ?? '', line);
    const amountCents = parseAmount(r[col.amount] ?? '', line);
    const memo = (r[col.memo] ?? '').trim();
    const id = col.id < 0 ? '' : (r[col.id] ?? '').trim();
    return {
      fitid: id || stableId(counts, date, amountCents, memo),
      type: amountCents < 0 ? 'DEBIT' : 'CREDIT',
      date,
      amountCents,
      memo,
    };
  });
  return statement('BANK', transactions);
}

export function parseNubankCardCsv(text: string): OfxStatement {
  const { header, rows } = bodyOf(text);
  if (header.map(normalizeHeader).includes('identificador')) {
    throw new CsvError(
      'Este CSV parece ser do extrato da conta (tem a coluna Identificador). Importe-o em Lançamentos → Importar.',
    );
  }
  const col = findColumns(header, {
    date: { names: ['date', 'data'], required: true },
    title: { names: ['title', 'descricao', 'estabelecimento', 'description'], required: true },
    amount: { names: ['amount', 'valor'], required: true },
  });
  const counts = new Map<string, number>();
  const transactions = rows.map((r, i): OfxTransaction => {
    const line = i + 2;
    const date = parseDate(r[col.date] ?? '', line);
    // no CSV da fatura a compra é positiva; no formato interno (como o OFX) a compra é negativa
    const amountCents = -parseAmount(r[col.amount] ?? '', line);
    const memo = (r[col.title] ?? '').trim();
    return {
      fitid: stableId(counts, date, amountCents, memo),
      type: amountCents < 0 ? 'DEBIT' : 'CREDIT',
      date,
      amountCents,
      memo,
    };
  });
  return statement('CREDIT_CARD', transactions);
}
