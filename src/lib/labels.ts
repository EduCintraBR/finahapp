/** Rótulos pt-BR dos enums (compartilhados por servidor, cliente e bot). */

export const ACCOUNT_PAYMENT_METHODS = [
  'PIX',
  'DEBIT',
  'CASH',
  'BOLETO',
  'BANK_TRANSFER',
  'AUTO_DEBIT',
  'OTHER',
] as const;
export type AccountPaymentMethod = (typeof ACCOUNT_PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  PIX: 'Pix',
  DEBIT: 'Débito',
  CASH: 'Dinheiro',
  BOLETO: 'Boleto',
  BANK_TRANSFER: 'Transferência',
  AUTO_DEBIT: 'Débito automático',
  CREDIT_CARD: 'Cartão de crédito',
  BENEFIT_CARD: 'Cartão de benefícios',
  OTHER: 'Outro',
};

export const KIND_LABEL: Record<string, string> = {
  INCOME: 'Receita',
  EXPENSE: 'Despesa',
  INVOICE_PAYMENT: 'Pagamento de fatura',
  ANTICIPATION_PAYMENT: 'Antecipação',
  TRANSFER_IN: 'Transferência recebida',
  TRANSFER_OUT: 'Transferência enviada',
  ADJUSTMENT_IN: 'Ajuste (entrada)',
  ADJUSTMENT_OUT: 'Ajuste (saída)',
};

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendente',
  POSTED: 'Pago',
  CANCELLED: 'Cancelado',
};

export const RECURRING_TYPE_LABEL: Record<string, string> = {
  FIXED: 'Fixo (valor exato)',
  RECURRING_VARIABLE: 'Recorrente (valor estimado)',
};
