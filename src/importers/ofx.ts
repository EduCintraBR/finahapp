/**
 * Leitor de OFX genérico (1.x SGML e 2.x XML), para fatura de cartão e extrato de conta.
 * Valores viram centavos a partir do TEXTO (nunca parseFloat); datas viram 'YYYY-MM-DD'
 * pela data local do banco (a parte do dia, sem conversão de fuso).
 */
import { isISODate, type ISODate } from '@/domain/dates';
import type { Cents } from '@/domain/money';

export type OfxTransaction = {
  fitid: string;
  type: string;
  date: ISODate;
  amountCents: Cents;
  memo: string;
};

export type OfxStatement = {
  account: 'CREDIT_CARD' | 'BANK';
  accountId: string | null;
  currency: string | null;
  periodStart: ISODate | null;
  periodEnd: ISODate | null;
  /** saldo informado pelo banco (cartão: negativo = a pagar) */
  ledgerBalanceCents: Cents | null;
  transactions: OfxTransaction[];
};

export class OfxError extends Error {
  override name = 'OfxError';
}

/** Decodifica os bytes pelo charset do cabeçalho (OFX 1.x: CHARSET:1252; 2.x: encoding do XML). */
export function decodeOfx(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 600));
  const charset = /CHARSET:\s*(\S+)/i.exec(head)?.[1] ?? /encoding="([^"]+)"/i.exec(head)?.[1] ?? 'utf-8';
  const label = /^(1252|windows-1252|cp1252)$/i.test(charset)
    ? 'windows-1252'
    : /^(iso-8859-1|latin1|8859-1)$/i.test(charset)
      ? 'latin1'
      : /^(utf-?8|none)$/i.test(charset)
        ? 'utf-8'
        : 'windows-1252';
  return new TextDecoder(label).decode(bytes);
}

const decodeEntities = (v: string) =>
  v
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** Valor de um elemento-folha: `<TAG>valor` (SGML, sem fechamento) ou `<TAG>valor</TAG>`. */
function leaf(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(block);
  return m ? decodeEntities(m[1]!.trim()) : null;
}

/** "-1351.87" · "2753,11" · "100" → centavos. Mais de 2 casas decimais é recusado. */
export function parseOfxAmount(raw: string): Cents {
  const m = /^([+-]?)(\d+)(?:[.,](\d{1,2}))?$/.exec(raw.trim());
  if (!m) throw new OfxError(`Valor inválido no OFX: "${raw}".`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new OfxError(`Valor alto demais no OFX: "${raw}".`);
  return m[1] === '-' && cents !== 0 ? -cents : cents;
}

/** "20261017000000[-3:BRT]" → '2026-10-17'. */
export function parseOfxDate(raw: string): ISODate {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  const iso = m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  if (!isISODate(iso)) throw new OfxError(`Data inválida no OFX: "${raw}".`);
  return iso;
}

export function parseOfx(text: string): OfxStatement {
  const start = text.search(/<OFX>/i);
  if (start < 0) throw new OfxError('Arquivo não parece um OFX (não encontrei <OFX>).');
  const body = text.slice(start);
  const isCard = /<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(body);

  const transactions: OfxTransaction[] = [];
  for (const m of body.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)) {
    const block = m[1]!;
    const fitid = leaf(block, 'FITID');
    const amount = leaf(block, 'TRNAMT');
    const date = leaf(block, 'DTPOSTED');
    if (!fitid || !amount || !date)
      throw new OfxError('Transação incompleta no OFX (falta FITID, TRNAMT ou DTPOSTED).');
    transactions.push({
      fitid,
      type: (leaf(block, 'TRNTYPE') ?? '').toUpperCase(),
      date: parseOfxDate(date),
      amountCents: parseOfxAmount(amount),
      memo: leaf(block, 'MEMO') ?? leaf(block, 'NAME') ?? '',
    });
  }
  if (transactions.length === 0) throw new OfxError('Nenhuma transação encontrada no OFX.');
  if (new Set(transactions.map((t) => t.fitid)).size !== transactions.length) {
    throw new OfxError('O OFX tem transações repetidas (FITID duplicado).');
  }

  const ledger = /<LEDGERBAL>([\s\S]*?)(?:<\/LEDGERBAL>|$)/i.exec(body)?.[1];
  const balAmt = ledger ? leaf(ledger, 'BALAMT') : null;
  const dtStart = leaf(body, 'DTSTART');
  const dtEnd = leaf(body, 'DTEND');
  return {
    account: isCard ? 'CREDIT_CARD' : 'BANK',
    accountId: leaf(body, 'ACCTID'),
    currency: leaf(body, 'CURDEF'),
    periodStart: dtStart ? parseOfxDate(dtStart) : null,
    periodEnd: dtEnd ? parseOfxDate(dtEnd) : null,
    ledgerBalanceCents: balAmt ? parseOfxAmount(balAmt) : null,
    transactions,
  };
}
