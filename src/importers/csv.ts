/**
 * Leitor de CSV tolerante (Fase 5): vírgula ou ponto e vírgula, campos entre aspas (com aspas duplas
 * escapadas e quebras de linha), BOM e CRLF. Devolve linhas de campos; linhas em branco são descartadas.
 */
import { OfxError } from './ofx';

/** Erro de leitura de um arquivo CSV (mensagem em pt-BR, mostrada ao usuário). */
export class CsvError extends OfxError {
  override name = 'CsvError';
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const head = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) endField();
    else if (c === '\n') endRow();
    else if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else field += c;
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Texto sem acento e em minúsculas, para comparar nomes de coluna. */
export const normalizeHeader = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Índices das colunas pelo nome (qualquer ordem); -1 para uma opcional ausente. Lança CsvError dizendo o que faltou. */
export function findColumns<K extends string>(
  header: readonly string[],
  spec: Record<K, { names: readonly string[]; required: boolean }>,
): Record<K, number> {
  const norm = header.map(normalizeHeader);
  const out = {} as Record<K, number>;
  const missing: string[] = [];
  for (const key of Object.keys(spec) as K[]) {
    const idx = norm.findIndex((h) => spec[key].names.includes(h));
    out[key] = idx;
    if (idx < 0 && spec[key].required) missing.push(spec[key].names[0]!);
  }
  if (missing.length > 0) {
    throw new CsvError(
      `Não encontrei as colunas ${missing.map((m) => `"${m}"`).join(', ')} no CSV. As colunas do arquivo são: ${header.map((h) => `"${h.trim()}"`).join(', ')}.`,
    );
  }
  return out;
}
