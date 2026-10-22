/**
 * Finah — Controle Financeiro do Casal
 * Schema Drizzle ORM (PostgreSQL 16+)
 *
 * Convenções:
 *  - Dinheiro: SEMPRE em centavos, BIGINT com mode 'number' (seguro até 2^53 ≈ R$ 90 trilhões,
 *    e sem a dor de serializar BigInt em Server Components / JSON).
 *  - Datas de negócio: DATE com mode 'string' ('YYYY-MM-DD'). Nunca use timestamp para data de
 *    compra/vencimento: meia-noite em America/Sao_Paulo vira o dia anterior em UTC.
 *  - "Mês" (competência, referência de fatura, ocorrência de recorrente) = DATE do 1º dia do mês.
 *  - Saldos e limites NÃO são armazenados: são derivados de lançamentos imutáveis.
 *  - Valores em `transactions` são sempre positivos; a direção vem de `kind`.
 *    Valores em `invoice_items` são assinados (créditos/estornos negativos).
 */
import { sql } from 'drizzle-orm';
import {
  pgTable, pgEnum, uuid, text, varchar, boolean, smallint, integer, bigint, date,
  timestamp, jsonb, index, uniqueIndex, unique, check, type AnyPgColumn,
} from 'drizzle-orm/pg-core';

// ─────────────────────────── helpers ───────────────────────────
const money = (name: string) => bigint(name, { mode: 'number' });
const day = (name: string) => date(name, { mode: 'string' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());
const deletedAt = () => timestamp('deleted_at', { withTimezone: true });
const pk = () => uuid('id').primaryKey().defaultRandom();

// ─────────────────────────── enums ───────────────────────────
export const bankAccountKind = pgEnum('bank_account_kind', ['CHECKING', 'SAVINGS', 'CASH_WALLET']);
export const categoryKind = pgEnum('category_kind', ['EXPENSE', 'INCOME']);

export const transactionKind = pgEnum('transaction_kind', [
  'INCOME',               // + caixa  | entra em relatórios de receita
  'EXPENSE',              // - caixa (ou cartão) | entra em Gasto Bruto e Gasto Mensal
  'INVOICE_PAYMENT',      // - caixa  | NÃO é gasto (as parcelas já são) → evita contagem dupla
  'ANTICIPATION_PAYMENT', // - caixa  | antecipação paga avulsa (fora da fatura); entra no Gasto Mensal
  'TRANSFER_IN',          // + caixa  | movimentação entre contas próprias
  'TRANSFER_OUT',         // - caixa
  'ADJUSTMENT_IN',        // + caixa  | acerto de saldo após conciliação
  'ADJUSTMENT_OUT',       // - caixa
]);
export const transactionStatus = pgEnum('transaction_status', ['PENDING', 'POSTED', 'CANCELLED']);
export const paymentMethod = pgEnum('payment_method', [
  'PIX', 'DEBIT', 'CASH', 'BOLETO', 'BANK_TRANSFER', 'AUTO_DEBIT', 'CREDIT_CARD', 'OTHER',
]);
export const entrySource = pgEnum('entry_source', [
  'MANUAL', 'BOT', 'IMPORT', 'RECURRING', 'SYSTEM',
  'ONBOARDING', // cadastro inicial de parcelamentos já em andamento
]);

export const recurringType = pgEnum('recurring_type', ['FIXED', 'RECURRING_VARIABLE']);
export const recurringDirection = pgEnum('recurring_direction', ['INCOME', 'EXPENSE']);

export const invoiceStatus = pgEnum('invoice_status', ['OPEN', 'CLOSED', 'PAID']);
export const installmentPlanStatus = pgEnum('installment_plan_status', [
  'ACTIVE', 'FINISHED', 'CANCELLED', 'FULLY_ANTICIPATED',
]);
export const invoiceItemKind = pgEnum('invoice_item_kind', [
  'INSTALLMENT',   // parcela (compra à vista = plano com 1 parcela)
  'ANTICIPATION',  // valor líquido de uma antecipação lançado na fatura
  'REFUND_CREDIT', // crédito de estorno (negativo)
  'ADJUSTMENT',    // acerto manual na fatura (pode ser + ou -)
]);
export const invoiceItemStatus = pgEnum('invoice_item_status', ['ACTIVE', 'ANTICIPATED', 'CANCELLED']);

export const anticipationSettlement = pgEnum('anticipation_settlement', ['ON_INVOICE', 'DIRECT_PAYMENT']);
export const refundMode = pgEnum('refund_mode', [
  'CREDIT_KEEP_INSTALLMENTS', // Modo A
  'CANCEL_PURCHASE',          // Modo B
]);

export const importKind = pgEnum('import_kind', ['BANK_STATEMENT', 'CARD_STATEMENT']);
export const importFormat = pgEnum('import_format', ['OFX', 'CSV']);
export const importBatchStatus = pgEnum('import_batch_status', ['PARSED', 'IN_REVIEW', 'COMPLETED', 'FAILED']);
export const importLineStatus = pgEnum('import_line_status', [
  'PENDING_REVIEW', 'MATCHED', 'CREATED', 'IGNORED',
]);

export const botMessageType = pgEnum('bot_message_type', ['TEXT', 'VOICE', 'COMMAND']);
export const botMessageStatus = pgEnum('bot_message_status', [
  'RECEIVED', 'PARSED', 'AWAITING_CONFIRMATION', 'CREATED', 'REJECTED', 'UNDONE', 'FAILED',
]);

// ─────────────────────────── users ───────────────────────────
export const users = pgTable('users', {
  id: pk(),
  name: varchar('name', { length: 80 }).notNull(),
  email: varchar('email', { length: 160 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),           // argon2id
  telegramUserId: bigint('telegram_user_id', { mode: 'number' }).unique(), // whitelist do bot
  color: varchar('color', { length: 16 }),                 // badge "Ele/Ela" na UI
  // 2FA (TOTP, D64): segredos cifrados com AES-256-GCM (chave derivada do AUTH_SECRET); nunca em texto puro
  totpSecret: text('totp_secret'),                          // autenticador ativo
  totpPendingSecret: text('totp_pending_secret'),           // em cadastro (até confirmar o 1º código)
  totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
  totpLastStep: bigint('totp_last_step', { mode: 'number' }), // último passo de 30 s aceito (sem reuso de código)
  recoveryCodeHashes: text('recovery_code_hashes').array().notNull().default(sql`'{}'::text[]`), // sha256, uso único
  pendingRecoveryCodeHashes: text('pending_recovery_code_hashes').array().notNull().default(sql`'{}'::text[]`),
  // sobe ao trocar a senha / "sair de todos os aparelhos": sessões com versão antiga deixam de valer
  sessionVersion: integer('session_version').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ─────────────────────────── bank accounts ───────────────────────────
export const bankAccounts = pgTable('bank_accounts', {
  id: pk(),
  name: varchar('name', { length: 80 }).notNull(),
  kind: bankAccountKind('kind').notNull().default('CHECKING'),
  isPrimary: boolean('is_primary').notNull().default(false),
  openingBalanceCents: money('opening_balance_cents').notNull().default(0), // pode ser negativo
  openingBalanceDate: day('opening_balance_date').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  // Exatamente uma conta principal ("Caixa Único")
  uniqueIndex('bank_accounts_single_primary').on(t.isPrimary).where(sql`${t.isPrimary} = true`),
]);

// Conferência periódica: "o app diz X, o banco diz Y" → gera ADJUSTMENT se divergir
export const balanceCheckpoints = pgTable('balance_checkpoints', {
  id: pk(),
  bankAccountId: uuid('bank_account_id').notNull().references(() => bankAccounts.id),
  checkpointDate: day('checkpoint_date').notNull(),
  statementBalanceCents: money('statement_balance_cents').notNull(),
  computedBalanceCents: money('computed_balance_cents').notNull(),
  adjustmentTransactionId: uuid('adjustment_transaction_id').references((): AnyPgColumn => transactions.id),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [unique('balance_checkpoints_account_date').on(t.bankAccountId, t.checkpointDate)]);

// ─────────────────────────── categories ───────────────────────────
export const categories = pgTable('categories', {
  id: pk(),
  name: varchar('name', { length: 60 }).notNull(),
  kind: categoryKind('kind').notNull(),
  parentId: uuid('parent_id').references((): AnyPgColumn => categories.id),
  icon: varchar('icon', { length: 40 }),   // nome do ícone Lucide
  color: varchar('color', { length: 16 }),
  botAliases: text('bot_aliases').array().notNull().default(sql`'{}'::text[]`), // "mercado","super"
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  unique('categories_kind_parent_name').on(t.kind, t.parentId, t.name).nullsNotDistinct(),
]);

// ─────────────────────────── credit cards ───────────────────────────
/**
 * Cartões virtuais NÃO são linhas aqui: apontam para o cartão físico/titular.
 * Cartão adicional de outro titular (ex.: adicional na conta da mãe): is_additional = true.
 *  - A fatura real do banco é do titular e contém gastos de terceiros; aqui só existem
 *    os lançamentos do casal (linhas de terceiros no import → IGNORED).
 *  - limit_total_cents = sub-limite definido pelo titular, ou NULL = limite não rastreado
 *    (o limite real é compartilhado com o titular e não é calculável pelo app).
 *  - INVOICE_PAYMENT = o que o casal efetivamente paga (ex.: Pix ao titular).
 */
export const creditCards = pgTable('credit_cards', {
  id: pk(),
  name: varchar('name', { length: 80 }).notNull(),   // "Nubank Eduardo"
  issuer: varchar('issuer', { length: 60 }),          // "Nubank"
  last4: varchar('last4', { length: 4 }),            // só identificação visual
  isAdditional: boolean('is_additional').notNull().default(false),
  holderName: varchar('holder_name', { length: 80 }), // titular quando is_additional (ex.: "Mãe")
  limitTotalCents: money('limit_total_cents'),         // NULL = não rastrear limite
  closingDay: smallint('closing_day').notNull(),      // padrão; a data real fica em invoices
  dueDay: smallint('due_day').notNull(),
  paymentAccountId: uuid('payment_account_id').notNull().references(() => bankAccounts.id),
  botAliases: text('bot_aliases').array().notNull().default(sql`'{}'::text[]`), // "itaú","roxinho"
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('credit_cards_limit_positive', sql`${t.limitTotalCents} is null or ${t.limitTotalCents} >= 0`),
  check('credit_cards_additional_holder', sql`not ${t.isAdditional} or ${t.holderName} is not null`),
  check('credit_cards_closing_day', sql`${t.closingDay} between 1 and 31`),
  check('credit_cards_due_day', sql`${t.dueDay} between 1 and 31`),
]);

/**
 * Fatura materializada. As datas reais ficam aqui (editáveis), porque bancos movem
 * fechamento/vencimento em fins de semana/feriados e meses curtos (dia 31 em fevereiro).
 * Regra de alocação: compra vai para a fatura de MENOR closing_date > purchase_date.
 * (equivale a "antes do fechamento → esta; no dia ou depois → próxima").
 */
export const invoices = pgTable('invoices', {
  id: pk(),
  creditCardId: uuid('credit_card_id').notNull().references(() => creditCards.id),
  referenceMonth: day('reference_month').notNull(),  // 1º dia do mês de VENCIMENTO
  closingDate: day('closing_date').notNull(),
  dueDate: day('due_date').notNull(),
  status: invoiceStatus('status').notNull().default('OPEN'),
  paidAt: day('paid_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  unique('invoices_card_month').on(t.creditCardId, t.referenceMonth),
  unique('invoices_card_closing').on(t.creditCardId, t.closingDate),
  check('invoices_due_after_closing', sql`${t.dueDate} > ${t.closingDate}`),
  check('invoices_reference_is_due_month',
    sql`${t.referenceMonth} = date_trunc('month', ${t.dueDate})::date`),
  check('invoices_paid_has_date', sql`${t.status} <> 'PAID' or ${t.paidAt} is not null`),
  index('invoices_card_due').on(t.creditCardId, t.dueDate),
]);

// ─────────────────────────── recurring templates ───────────────────────────
/**
 * Modelo de gasto fixo / recorrente / receita prevista.
 * Ocorrências do mês são materializadas como `transactions` PENDING (idempotente por
 * (template, mês)). Meses futuros na projeção são calculados virtualmente, sem persistir.
 * Mudança de valor "a partir de" = encerrar este (end_month) e criar novo template.
 */
export const recurringTemplates = pgTable('recurring_templates', {
  id: pk(),
  type: recurringType('type').notNull(),
  direction: recurringDirection('direction').notNull(),
  description: varchar('description', { length: 140 }).notNull(),
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  expectedAmountCents: money('expected_amount_cents').notNull(), // FIXED: exato | VARIABLE: estimativa
  dayOfMonth: smallint('day_of_month').notNull(),                 // vencimento (ou dia da cobrança no cartão)
  paymentMethod: paymentMethod('payment_method').notNull(),
  bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id),
  creditCardId: uuid('credit_card_id').references(() => creditCards.id), // ex.: streaming no cartão
  startMonth: day('start_month').notNull(),
  endMonth: day('end_month'),
  isActive: boolean('is_active').notNull().default(true),
  beneficiaryUserId: uuid('beneficiary_user_id').references(() => users.id), // null = casal
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('recurring_amount_positive', sql`${t.expectedAmountCents} > 0`),
  check('recurring_day', sql`${t.dayOfMonth} between 1 and 31`),
  check('recurring_start_is_month', sql`extract(day from ${t.startMonth}) = 1`),
  check('recurring_end_after_start', sql`${t.endMonth} is null or ${t.endMonth} >= ${t.startMonth}`),
  check('recurring_target', sql`
    (${t.paymentMethod} = 'CREDIT_CARD' and ${t.creditCardId} is not null and ${t.bankAccountId} is null
       and ${t.direction} = 'EXPENSE')
    or (${t.paymentMethod} <> 'CREDIT_CARD' and ${t.creditCardId} is null and ${t.bankAccountId} is not null)`),
]);

// ─────────────────────────── transactions ───────────────────────────
/**
 * O FATO econômico. Duas famílias:
 *  - Lado caixa (bank_account_id): afeta saldo quando status = POSTED (posted_date).
 *  - Compra no cartão (credit_card_id, kind = EXPENSE): NÃO afeta saldo; gera installment_plan
 *    + invoice_items. O caixa só é afetado depois, pela transaction INVOICE_PAYMENT.
 *
 * Gasto Bruto (competência)  = Σ EXPENSE (bank + card, não canceladas) por transaction_date
 *                            − Σ refund_records.amount por refund_date (estorno reduz o mês do estorno;
 *                              o mês da compra original fica intacto como histórico)
 *                            (source = ONBOARDING fica fora dos relatórios de meses anteriores ao uso)
 * Gasto Mensal (caixa)       = Σ EXPENSE lado caixa por due/posted no mês
 *                            + Σ invoice_items ACTIVE das faturas que vencem no mês
 *                            + Σ ANTICIPATION_PAYMENT do mês
 * Saldo                      = opening + Σ(+/-) transações POSTED lado caixa
 */
export const transactions = pgTable('transactions', {
  id: pk(),
  kind: transactionKind('kind').notNull(),
  status: transactionStatus('status').notNull().default('POSTED'),
  description: varchar('description', { length: 200 }).notNull(),
  notes: text('notes'),
  amountCents: money('amount_cents').notNull(),                  // sempre > 0
  estimatedAmountCents: money('estimated_amount_cents'),        // snapshot da estimativa (recorrente variável)
  paymentMethod: paymentMethod('payment_method').notNull(),
  bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id),
  creditCardId: uuid('credit_card_id').references(() => creditCards.id),
  categoryId: uuid('category_id').references(() => categories.id),

  transactionDate: day('transaction_date').notNull(), // data do fato (compra/competência)
  dueDate: day('due_date'),                           // vencimento (pendentes)
  postedDate: day('posted_date'),                     // data em que bateu no caixa

  recurringTemplateId: uuid('recurring_template_id').references(() => recurringTemplates.id),
  occurrenceMonth: day('occurrence_month'),
  paidInvoiceId: uuid('paid_invoice_id').references(() => invoices.id), // só INVOICE_PAYMENT
  transferGroupId: uuid('transfer_group_id'),

  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id), // quem lançou
  beneficiaryUserId: uuid('beneficiary_user_id').references(() => users.id),        // de quem é o gasto (null = casal)
  source: entrySource('source').notNull().default('MANUAL'),

  version: integer('version').notNull().default(1), // lock otimista
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  check('tx_amount_positive', sql`${t.amountCents} > 0`),
  check('tx_target', sql`
    (${t.paymentMethod} = 'CREDIT_CARD' and ${t.creditCardId} is not null and ${t.bankAccountId} is null
       and ${t.kind} = 'EXPENSE')
    or (${t.paymentMethod} <> 'CREDIT_CARD' and ${t.creditCardId} is null and ${t.bankAccountId} is not null)`),
  check('tx_posted_has_date', sql`${t.status} <> 'POSTED' or ${t.postedDate} is not null`),
  check('tx_pending_has_due', sql`${t.status} <> 'PENDING' or ${t.dueDate} is not null`),
  check('tx_invoice_payment_link', sql`(${t.kind} = 'INVOICE_PAYMENT') = (${t.paidInvoiceId} is not null)`),
  check('tx_category_required', sql`${t.kind} not in ('INCOME','EXPENSE') or ${t.categoryId} is not null`),
  check('tx_recurring_pair', sql`(${t.recurringTemplateId} is null) = (${t.occurrenceMonth} is null)`),
  check('tx_transfer_group',
    sql`${t.kind} not in ('TRANSFER_IN','TRANSFER_OUT') or ${t.transferGroupId} is not null`),
  // Uma ocorrência por template por mês → geração idempotente
  uniqueIndex('tx_recurring_occurrence').on(t.recurringTemplateId, t.occurrenceMonth)
    .where(sql`${t.recurringTemplateId} is not null and ${t.deletedAt} is null`),
  index('tx_bank_posted').on(t.bankAccountId, t.postedDate).where(sql`${t.deletedAt} is null`),
  index('tx_date').on(t.transactionDate).where(sql`${t.deletedAt} is null`),
  index('tx_pending_due').on(t.dueDate).where(sql`${t.status} = 'PENDING' and ${t.deletedAt} is null`),
  index('tx_paid_invoice').on(t.paidInvoiceId),
  index('tx_created_by').on(t.createdByUserId),
]);

// ─────────────────────────── installment plans ───────────────────────────
/**
 * Grupo de parcelamento. Toda compra no cartão tem um plano (à vista = 1 parcela).
 * Parcelamento já em andamento ao começar a usar o app (ONBOARDING):
 *  first_tracked_installment = N → só existem invoice_items de N..installment_count.
 *  O invariante Σ parcelas = total só vale quando first_tracked_installment = 1.
 */
export const installmentPlans = pgTable('installment_plans', {
  id: pk(),
  transactionId: uuid('transaction_id').notNull().unique().references(() => transactions.id),
  creditCardId: uuid('credit_card_id').notNull().references(() => creditCards.id),
  totalAmountCents: money('total_amount_cents').notNull(),
  installmentCount: smallint('installment_count').notNull(),
  firstTrackedInstallment: smallint('first_tracked_installment').notNull().default(1),
  purchaseDate: day('purchase_date').notNull(),
  firstInvoiceId: uuid('first_invoice_id').notNull().references(() => invoices.id),
  status: installmentPlanStatus('status').notNull().default('ACTIVE'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('plan_total_positive', sql`${t.totalAmountCents} > 0`),
  check('plan_count', sql`${t.installmentCount} between 1 and 72`),
  check('plan_total_divisible', sql`${t.totalAmountCents} >= ${t.installmentCount}`),
  check('plan_first_tracked',
    sql`${t.firstTrackedInstallment} between 1 and ${t.installmentCount}`),
  index('plan_card_status').on(t.creditCardId, t.status),
]);

// ─────────────────────────── anticipation ───────────────────────────
export const anticipationRecords = pgTable('anticipation_records', {
  id: pk(),
  installmentPlanId: uuid('installment_plan_id').notNull().references(() => installmentPlans.id),
  anticipationDate: day('anticipation_date').notNull(),
  installmentsCount: smallint('installments_count').notNull(),
  grossAmountCents: money('gross_amount_cents').notNull(),  // soma original das parcelas
  discountCents: money('discount_cents').notNull().default(0),
  paidAmountCents: money('paid_amount_cents').notNull(),    // líquido
  settlement: anticipationSettlement('settlement').notNull(),
  targetInvoiceId: uuid('target_invoice_id').references(() => invoices.id),          // ON_INVOICE
  paymentTransactionId: uuid('payment_transaction_id').unique().references(() => transactions.id), // DIRECT_PAYMENT
  notes: text('notes'),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  check('antic_count', sql`${t.installmentsCount} >= 1`),
  check('antic_math', sql`${t.grossAmountCents} - ${t.discountCents} = ${t.paidAmountCents}`),
  check('antic_non_negative', sql`${t.discountCents} >= 0 and ${t.paidAmountCents} > 0`),
  check('antic_settlement', sql`
    (${t.settlement} = 'ON_INVOICE' and ${t.targetInvoiceId} is not null and ${t.paymentTransactionId} is null)
    or (${t.settlement} = 'DIRECT_PAYMENT' and ${t.paymentTransactionId} is not null and ${t.targetInvoiceId} is null)`),
]);

// ─────────────────────────── refunds ───────────────────────────
export const refundRecords = pgTable('refund_records', {
  id: pk(),
  transactionId: uuid('transaction_id').notNull().references(() => transactions.id), // compra original
  installmentPlanId: uuid('installment_plan_id').notNull().references(() => installmentPlans.id),
  mode: refundMode('mode').notNull(),
  refundDate: day('refund_date').notNull(),
  amountCents: money('amount_cents').notNull(),        // valor informado pelo usuário
  targetInvoiceId: uuid('target_invoice_id').references(() => invoices.id), // onde cai o crédito
  reason: text('reason'),
  createdByUserId: uuid('created_by_user_id').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  check('refund_amount_positive', sql`${t.amountCents} > 0`),
  check('refund_mode_a_needs_invoice',
    sql`${t.mode} <> 'CREDIT_KEEP_INSTALLMENTS' or ${t.targetInvoiceId} is not null`),
  index('refund_plan').on(t.installmentPlanId),
]);

// ─────────────────────────── invoice items ───────────────────────────
/**
 * Linha de fatura (o "razão" do cartão). Valor assinado.
 * Limite usado = Σ amount (status ACTIVE, todas as faturas) − Σ INVOICE_PAYMENT do cartão.
 * Total da fatura = Σ amount ACTIVE da fatura.
 */
export const invoiceItems = pgTable('invoice_items', {
  id: pk(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  creditCardId: uuid('credit_card_id').notNull().references(() => creditCards.id), // denormalizado p/ limite
  kind: invoiceItemKind('kind').notNull(),
  status: invoiceItemStatus('status').notNull().default('ACTIVE'),
  amountCents: money('amount_cents').notNull(),
  description: varchar('description', { length: 200 }).notNull(), // "Mercado (2/3)"
  postingDate: day('posting_date').notNull(),
  installmentPlanId: uuid('installment_plan_id').references(() => installmentPlans.id),
  installmentNumber: smallint('installment_number'),
  anticipationRecordId: uuid('anticipation_record_id').references(() => anticipationRecords.id),
  refundRecordId: uuid('refund_record_id').references(() => refundRecords.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('item_installment_shape', sql`${t.kind} <> 'INSTALLMENT' or (
    ${t.installmentPlanId} is not null and ${t.installmentNumber} >= 1 and ${t.amountCents} > 0)`),
  check('item_anticipation_shape', sql`${t.kind} <> 'ANTICIPATION' or (
    ${t.anticipationRecordId} is not null and ${t.installmentPlanId} is not null and ${t.amountCents} > 0)`),
  check('item_refund_shape', sql`${t.kind} <> 'REFUND_CREDIT' or (
    ${t.refundRecordId} is not null and ${t.amountCents} < 0)`),
  check('item_adjustment_nonzero', sql`${t.kind} <> 'ADJUSTMENT' or ${t.amountCents} <> 0`),
  check('item_anticipated_link', sql`${t.status} <> 'ANTICIPATED' or (
    ${t.kind} = 'INSTALLMENT' and ${t.anticipationRecordId} is not null)`),
  uniqueIndex('item_plan_number').on(t.installmentPlanId, t.installmentNumber)
    .where(sql`${t.kind} = 'INSTALLMENT'`),
  index('item_invoice').on(t.invoiceId, t.status),
  index('item_card_status').on(t.creditCardId, t.status),
]);

// ─────────────────────────── import / reconciliation ───────────────────────────
export const importBatches = pgTable('import_batches', {
  id: pk(),
  kind: importKind('kind').notNull(),
  format: importFormat('format').notNull(),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileSha256: varchar('file_sha256', { length: 64 }).notNull().unique(), // mesmo arquivo 2x = bloqueado
  bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id),
  creditCardId: uuid('credit_card_id').references(() => creditCards.id),
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  status: importBatchStatus('status').notNull().default('PARSED'),
  periodStart: day('period_start'),
  periodEnd: day('period_end'),
  uploadedByUserId: uuid('uploaded_by_user_id').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  check('import_target', sql`
    (${t.kind} = 'BANK_STATEMENT' and ${t.bankAccountId} is not null and ${t.creditCardId} is null)
    or (${t.kind} = 'CARD_STATEMENT' and ${t.creditCardId} is not null and ${t.bankAccountId} is null)`),
]);

export const importLines = pgTable('import_lines', {
  id: pk(),
  batchId: uuid('batch_id').notNull().references(() => importBatches.id, { onDelete: 'cascade' }),
  bankAccountId: uuid('bank_account_id').references(() => bankAccounts.id),
  creditCardId: uuid('credit_card_id').references(() => creditCards.id),
  // FITID do OFX; no CSV: sha256(data|valor|descrição|nº da ocorrência no arquivo)
  dedupKey: varchar('dedup_key', { length: 128 }).notNull(),
  lineDate: day('line_date').notNull(),
  amountCents: money('amount_cents').notNull(),     // assinado como veio do banco
  rawDescription: text('raw_description').notNull(),
  rawPayload: jsonb('raw_payload'),
  status: importLineStatus('status').notNull().default('PENDING_REVIEW'),
  matchScore: smallint('match_score'),              // 0–100
  suggestedTransactionId: uuid('suggested_transaction_id').references(() => transactions.id),
  suggestedInvoiceItemId: uuid('suggested_invoice_item_id').references(() => invoiceItems.id),
  matchedTransactionId: uuid('matched_transaction_id').references(() => transactions.id),
  matchedInvoiceItemId: uuid('matched_invoice_item_id').references(() => invoiceItems.id),
  reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  check('line_one_target', sql`(${t.bankAccountId} is null) <> (${t.creditCardId} is null)`),
  check('line_matched_has_link', sql`${t.status} <> 'MATCHED' or
    ${t.matchedTransactionId} is not null or ${t.matchedInvoiceItemId} is not null`),
  // Reimportar extrato sobreposto não duplica linhas
  uniqueIndex('line_bank_dedup').on(t.bankAccountId, t.dedupKey).where(sql`${t.bankAccountId} is not null`),
  uniqueIndex('line_card_dedup').on(t.creditCardId, t.dedupKey).where(sql`${t.creditCardId} is not null`),
  // 1:1 por lado (D48): o mesmo pagamento de fatura é conciliado pela linha da fatura E pela do extrato
  uniqueIndex('line_matched_tx_bank')
    .on(t.matchedTransactionId)
    .where(sql`${t.matchedTransactionId} is not null and ${t.bankAccountId} is not null`),
  uniqueIndex('line_matched_tx_card')
    .on(t.matchedTransactionId)
    .where(sql`${t.matchedTransactionId} is not null and ${t.creditCardId} is not null`),
  uniqueIndex('line_matched_item').on(t.matchedInvoiceItemId).where(sql`${t.matchedInvoiceItemId} is not null`),
  index('line_batch_status').on(t.batchId, t.status),
]);

// ─────────────────────────── bot ───────────────────────────
export const botMessages = pgTable('bot_messages', {
  id: pk(),
  telegramUpdateId: bigint('telegram_update_id', { mode: 'number' }).notNull().unique(), // idempotência (Telegram reenvia)
  telegramChatId: bigint('telegram_chat_id', { mode: 'number' }).notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
  messageType: botMessageType('message_type').notNull(),
  rawText: text('raw_text'),
  transcription: text('transcription'),
  parsedPayload: jsonb('parsed_payload'),   // saída estruturada do LLM (validada por Zod)
  confidence: smallint('confidence'),       // 0–100
  status: botMessageStatus('status').notNull().default('RECEIVED'),
  transactionId: uuid('transaction_id').references(() => transactions.id),
  errorMessage: text('error_message'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('bot_user_created').on(t.userId, t.createdAt)]);

// ─────────────────────────── audit ───────────────────────────
export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').references(() => users.id),
  entity: varchar('entity', { length: 60 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  action: varchar('action', { length: 30 }).notNull(), // CREATE, UPDATE, DELETE, CONFIRM_PAYMENT, ANTICIPATE, REFUND...
  before: jsonb('before'),
  after: jsonb('after'),
  createdAt: createdAt(),
}, (t) => [index('audit_entity').on(t.entity, t.entityId)]);
