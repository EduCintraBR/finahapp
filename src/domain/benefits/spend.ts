/**
 * Gastos no cartão de benefícios (D65, D78): o que pode ser editado e quanto cabe na carteira ao editar.
 * Regras puras: o saldo da carteira vem de fora (derivado, nunca armazenado).
 */
import type { Cents } from '../money';

/**
 * Gasto avulso no benefício (lançado direto na carteira). Conta paga com a carteira (tinha vencimento, é ocorrência
 * de fixo ou pagamento antecipado) não se edita: volta pela exclusão, que devolve a conta para "a pagar".
 */
export function isPlainBenefitSpend(t: {
  kind: string;
  benefitWalletId: string | null;
  dueDate: string | null;
  recurringTemplateId: string | null;
  anticipatesTransactionId: string | null;
}): boolean {
  return (
    t.kind === 'EXPENSE' &&
    t.benefitWalletId !== null &&
    t.dueDate === null &&
    t.recurringTemplateId === null &&
    t.anticipatesTransactionId === null
  );
}

/**
 * Quanto o gasto editado pode valer na carteira `targetWalletId`, cujo saldo atual é `targetBalance`. Na mesma
 * carteira, o que o próprio gasto já tirou dela volta para a conta; em outra carteira, só o saldo dela.
 */
export function spendEditLimit(
  spend: { walletId: string; amountCents: Cents },
  targetWalletId: string,
  targetBalance: Cents,
): Cents {
  return targetBalance + (targetWalletId === spend.walletId ? spend.amountCents : 0);
}
