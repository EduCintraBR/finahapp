/**
 * Conciliação (SPEC §8, D37): linha do extrato ↔ lançamento existente.
 *  - candidato só com o MESMO valor exato;
 *  - parcela: o item precisa ter o mesmo número k (a data da parcela não é a da compra);
 *  - compra à vista / pagamento: data até ±3 dias;
 *  - score 0–100 = proximidade da data + semelhança da descrição;
 *  - atribuição 1:1 gulosa pelo maior score (um lançamento concilia com uma linha só).
 * Nunca concilia sozinho: o resultado é só SUGESTÃO para a tela de revisão.
 */
import { diffDays, type ISODate } from '../dates';
import type { Cents } from '../money';

export type MatchLine = {
  id: string;
  amountCents: Cents;
  date: ISODate;
  description: string;
  installmentNumber: number | null;
};

export type MatchCandidate = MatchLine;

export const MAX_DAYS = 3;

const words = (s: string) =>
  new Set(
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3),
  );

/** Semelhança de descrição 0..1 (Jaccard das palavras com 3+ letras). */
export function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / (wa.size + wb.size - inter);
}

/** null = não é candidato. */
export function matchScore(line: MatchLine, c: MatchCandidate): number | null {
  if (line.amountCents !== c.amountCents) return null;
  const sim = similarity(line.description, c.description);
  if (line.installmentNumber !== null) {
    if (c.installmentNumber !== line.installmentNumber) return null;
    return Math.round(60 + 40 * sim);
  }
  if (c.installmentNumber !== null && c.installmentNumber !== 1) return null;
  const days = Math.abs(diffDays(line.date, c.date));
  if (days > MAX_DAYS) return null;
  return Math.round(60 * (1 - days / (MAX_DAYS + 1)) + 40 * sim);
}

export type Assignment = { lineId: string; candidateId: string; score: number };

/** 1:1 guloso: maior score primeiro; empate → menor distância de data → ordem estável. */
export function assignMatches(
  lines: readonly MatchLine[],
  candidates: readonly MatchCandidate[],
): Assignment[] {
  const pairs: (Assignment & { days: number })[] = [];
  for (const l of lines) {
    for (const c of candidates) {
      const score = matchScore(l, c);
      if (score !== null)
        pairs.push({ lineId: l.id, candidateId: c.id, score, days: Math.abs(diffDays(l.date, c.date)) });
    }
  }
  pairs.sort(
    (a, b) =>
      b.score - a.score ||
      a.days - b.days ||
      a.lineId.localeCompare(b.lineId) ||
      a.candidateId.localeCompare(b.candidateId),
  );
  const usedLines = new Set<string>();
  const usedCands = new Set<string>();
  const out: Assignment[] = [];
  for (const p of pairs) {
    if (usedLines.has(p.lineId) || usedCands.has(p.candidateId)) continue;
    usedLines.add(p.lineId);
    usedCands.add(p.candidateId);
    out.push({ lineId: p.lineId, candidateId: p.candidateId, score: p.score });
  }
  return out;
}
