/**
 * Extrato da conta (OFX do Nubank): classifica cada linha (D45–D47). Puro.
 *  - "Pagamento de fatura" → pagamento de fatura (INVOICE_PAYMENT);
 *  - Aplicação/Resgate (RDB, caixinha) e Pix com uma pessoa que tem o primeiro nome de um usuário
 *    (sem CNPJ) → transferência entre contas próprias;
 *  - o resto: saída → despesa, entrada → receita, com o meio inferido da descrição.
 */
import type { Cents } from '@/domain/money';
import type { AccountPaymentMethod } from '@/lib/labels';
import type { OfxTransaction } from './ofx';

export type AccountLineKind = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'INVOICE_PAYMENT';

export type AccountLine = {
  fitid: string;
  date: string;
  /** como veio do banco: saída < 0, entrada > 0 */
  bankAmountCents: Cents;
  amountCents: Cents;
  direction: 'IN' | 'OUT';
  memo: string;
  suggestedKind: AccountLineKind;
  paymentMethod: AccountPaymentMethod;
  /** contraparte / estabelecimento, sem o prefixo do banco */
  description: string;
};

const CNPJ = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/;

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Tira o prefixo do banco e os dados bancários: "Transferência enviada pelo Pix - RECEITA FEDERAL - 00.39…" → "RECEITA FEDERAL". */
export function counterparty(memo: string): string {
  const parts = memo.split(/\s+-\s+/);
  const prefix = normalize(parts[0] ?? '');
  const known =
    /^(transferencia (enviada|recebida)( pelo pix)?|compra no debito( via nupay)?|pagamento de boleto efetuado|pix (enviado|recebido)|transferencia)$/;
  if (parts.length > 1 && known.test(prefix)) {
    return (parts[1] ?? '').replace(/\s*\(transfer[eê]ncia (enviada|recebida)\)\s*$/i, '').trim() || memo;
  }
  return memo.trim();
}

function methodOf(memo: string): AccountPaymentMethod {
  const m = normalize(memo);
  if (m.includes('compra no debito')) return 'DEBIT';
  if (m.includes('boleto')) return 'BOLETO';
  if (m.includes('pix')) return 'PIX';
  if (m.startsWith('transferencia')) return 'BANK_TRANSFER';
  return 'OTHER';
}

const nameTokens = (s: string) =>
  normalize(s)
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 3);

/**
 * `ownerFirstNames`: primeiros nomes dos usuários (minúsculos, sem acento), ex.: ['eduardo', 'viviane'].
 * `cardHolders`: titulares dos cartões adicionais; Pix/transferência enviada para eles = pagamento da
 * fatura do adicional (D46). Exige nome com 2+ palavras, todas presentes na contraparte.
 */
export function classifyAccountLine(
  t: OfxTransaction,
  ownerFirstNames: readonly string[],
  cardHolders: readonly string[] = [],
): AccountLine {
  const direction = t.amountCents < 0 ? 'OUT' : 'IN';
  const memoN = normalize(t.memo);
  const cp = counterparty(t.memo);
  const cpFirst =
    normalize(cp)
      .split(/[^a-z]+/)
      .find(Boolean) ?? '';
  let suggestedKind: AccountLineKind;
  const cpTokens = new Set(nameTokens(cp));
  const paysHolder = cardHolders.some((h) => {
    const hs = nameTokens(h);
    return hs.length >= 2 && hs.every((w) => cpTokens.has(w));
  });
  if (direction === 'OUT' && /^pagamento de fatura/.test(memoN)) suggestedKind = 'INVOICE_PAYMENT';
  else if (direction === 'OUT' && !CNPJ.test(t.memo) && /transferencia|pix/.test(memoN) && paysHolder)
    suggestedKind = 'INVOICE_PAYMENT';
  else if (/\b(aplicacao|resgate)\b/.test(memoN) && /\b(rdb|caixinha|cdb)\b/.test(memoN))
    suggestedKind = 'TRANSFER';
  else if (!CNPJ.test(t.memo) && /transferencia|pix/.test(memoN) && ownerFirstNames.includes(cpFirst)) {
    suggestedKind = 'TRANSFER';
  } else suggestedKind = direction === 'OUT' ? 'EXPENSE' : 'INCOME';
  return {
    fitid: t.fitid,
    date: t.date,
    bankAmountCents: t.amountCents,
    amountCents: Math.abs(t.amountCents),
    direction,
    memo: t.memo,
    suggestedKind,
    paymentMethod: methodOf(t.memo),
    description: cp,
  };
}
