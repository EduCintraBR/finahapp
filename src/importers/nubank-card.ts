/**
 * Fatura do cartão (OFX do Nubank): classifica cada linha e sugere categoria. Puro.
 *  - DEBIT "Loja - Parcela k/N" → parcela; DEBIT sem "Parcela" → compra à vista;
 *  - CREDIT "Pagamento recebido" → pagamento; outros créditos (estornos) → crédito.
 * D34: os pagamentos que fecham o saldo do arquivo são desta fatura; os demais, da anterior.
 */
import type { Cents } from '@/domain/money';
import type { OfxTransaction } from './ofx';

export type CardLineKind = 'PURCHASE' | 'INSTALLMENT' | 'PAYMENT' | 'CREDIT';

export type CardLine = {
  fitid: string;
  date: string;
  /** como veio do banco: compra < 0, pagamento/crédito > 0 */
  bankAmountCents: Cents;
  /** valor positivo do item/pagamento */
  amountCents: Cents;
  memo: string;
  kind: CardLineKind;
  /** descrição sem o sufixo " - Parcela k/N" */
  description: string;
  installment: { k: number; n: number } | null;
};

const INSTALLMENT = /^(.*?)\s*-\s*Parcela\s+(\d{1,2})\s*\/\s*(\d{1,2})\s*$/i;

export function classifyCardLine(t: OfxTransaction): CardLine {
  const base = {
    fitid: t.fitid,
    date: t.date,
    bankAmountCents: t.amountCents,
    amountCents: Math.abs(t.amountCents),
    memo: t.memo,
  };
  if (t.amountCents > 0) {
    return {
      ...base,
      kind: /pagamento\s+recebido/i.test(t.memo) ? 'PAYMENT' : 'CREDIT',
      description: t.memo,
      installment: null,
    };
  }
  const m = INSTALLMENT.exec(t.memo);
  const k = m ? Number(m[2]) : 0;
  const n = m ? Number(m[3]) : 0;
  if (m && k >= 1 && n >= 2 && k <= n && n <= 72) {
    return { ...base, kind: 'INSTALLMENT', description: m[1]!.trim() || t.memo, installment: { k, n } };
  }
  return { ...base, kind: 'PURCHASE', description: t.memo, installment: null };
}

/**
 * D34 — quais pagamentos são desta fatura: o subconjunto (único) cuja soma fecha
 * Σ cobranças − Σ outros créditos − saldo a pagar do arquivo. null = não dá para saber.
 */
export function paymentsOfThisInvoice(
  lines: readonly CardLine[],
  ledgerBalanceCents: Cents | null,
): Set<string> | null {
  if (ledgerBalanceCents === null) return null;
  const charges = lines
    .filter((l) => l.kind === 'PURCHASE' || l.kind === 'INSTALLMENT')
    .reduce((s, l) => s + l.amountCents, 0);
  const otherCredits = lines.filter((l) => l.kind === 'CREDIT').reduce((s, l) => s + l.amountCents, 0);
  const target = charges - otherCredits + ledgerBalanceCents; // ledger < 0 = a pagar
  const payments = lines.filter((l) => l.kind === 'PAYMENT');
  if (payments.length > 16) return null;
  const solutions: Set<string>[] = [];
  for (let mask = 0; mask < 1 << payments.length; mask++) {
    let sum = 0;
    const chosen = new Set<string>();
    payments.forEach((p, i) => {
      if (mask & (1 << i)) {
        sum += p.amountCents;
        chosen.add(p.fitid);
      }
    });
    if (sum === target) solutions.push(chosen);
    if (solutions.length > 1) return null; // ambíguo: o usuário decide na revisão
  }
  return solutions[0] ?? null;
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Sugere categoria pelos apelidos (bot_aliases) contidos na descrição. null = "A classificar". */
export function suggestCategory(
  description: string,
  categories: readonly { id: string; kind: string; botAliases: readonly string[] }[],
): string | null {
  const text = ` ${normalize(description)} `;
  let best: { id: string; len: number } | null = null;
  for (const c of categories) {
    if (c.kind !== 'EXPENSE') continue;
    for (const alias of c.botAliases) {
      const a = normalize(alias);
      if (a.length >= 3 && text.includes(` ${a} `) && (!best || a.length > best.len))
        best = { id: c.id, len: a.length };
    }
  }
  return best?.id ?? null;
}
