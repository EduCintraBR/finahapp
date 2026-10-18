/**
 * Lê um arquivo de extrato/fatura (OFX ou CSV, detectado pelo conteúdo) no formato interno da importação.
 * O tipo esperado (conta ou cartão) vem de onde o arquivo foi enviado.
 */
import { CsvError } from './csv';
import { parseNubankAccountCsv, parseNubankCardCsv } from './nubank-csv';
import { decodeOfx, type OfxStatement, parseOfx } from './ofx';

export type StatementKind = 'BANK' | 'CREDIT_CARD';
export type Statement = OfxStatement & { format: 'OFX' | 'CSV' };

const looksLikeOfx = (bytes: Uint8Array) =>
  /<OFX[\s>]|OFXHEADER/i.test(new TextDecoder('latin1').decode(bytes.subarray(0, 4000)));

function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function readStatement(bytes: Uint8Array, kind: StatementKind): Statement {
  if (looksLikeOfx(bytes)) return { ...parseOfx(decodeOfx(bytes)), format: 'OFX' };
  const text = decodeCsv(bytes);
  try {
    return {
      ...(kind === 'BANK' ? parseNubankAccountCsv(text) : parseNubankCardCsv(text)),
      format: 'CSV',
    };
  } catch (err) {
    if (err instanceof CsvError) throw err;
    throw err;
  }
}
