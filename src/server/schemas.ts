/**
 * Validação de entrada (forms, Server Actions, bot) com mensagens em pt-BR.
 * Valores monetários chegam como texto ("1.234,56") e saem em centavos.
 */
import { z } from 'zod';
import { isISODate, monthStart, parseMonthParam } from '@/domain/dates';
import { MAX_BENEFIT_WALLETS } from '@/domain/benefits/credits';
import { tryParseBRL } from '@/domain/money';
import { ACCOUNT_PAYMENT_METHODS } from '@/lib/labels';

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/** Texto em BRL → centavos. `positive`: exige > 0 (valores de lançamento). */
export const money = (opts: { positive: boolean; label?: string }) =>
  z.preprocess(
    blankToUndefined,
    z.string({ error: `Informe ${opts.label ?? 'o valor'}.` }).transform((v, ctx) => {
      const r = tryParseBRL(v);
      if (!r.ok) {
        ctx.addIssue({ code: 'custom', message: r.error });
        return z.NEVER;
      }
      if (opts.positive && r.value <= 0) {
        ctx.addIssue({ code: 'custom', message: 'O valor precisa ser maior que zero.' });
        return z.NEVER;
      }
      return r.value;
    }),
  );

export const isoDate = z.string({ error: 'Informe a data.' }).refine(isISODate, { error: 'Data inválida.' });

/** "2026-10" (input type=month) ou "2026-10-01" → '2026-10-01'. */
export const monthInput = z.string({ error: 'Informe o mês.' }).transform((v, ctx) => {
  const m = parseMonthParam(v) ?? (isISODate(v) ? monthStart(v) : null);
  if (!m) {
    ctx.addIssue({ code: 'custom', message: 'Mês inválido.' });
    return z.NEVER;
  }
  return m;
});

const uuid = (msg: string) => z.uuid({ error: msg });
const optionalUuid = z.preprocess(blankToUndefined, z.uuid().optional()).transform((v) => v ?? null);
const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max).optional()).transform((v) => v ?? null);

export const entryInput = z.object({
  kind: z.enum(['INCOME', 'EXPENSE'], { error: 'Escolha receita ou despesa.' }),
  amount: money({ positive: true }),
  description: z
    .string({ error: 'Informe uma descrição.' })
    .trim()
    .min(1, { error: 'Informe uma descrição.' })
    .max(200, { error: 'Descrição muito longa (máx. 200).' }),
  categoryId: uuid('Escolha uma categoria.'),
  paymentMethod: z.enum(ACCOUNT_PAYMENT_METHODS, { error: 'Escolha o meio de pagamento.' }),
  date: isoDate,
  beneficiaryUserId: optionalUuid,
  notes: optionalText(2000),
});
export type EntryInput = z.output<typeof entryInput>;

export const versionInput = z.coerce.number().int().min(1);

export const confirmPaymentInput = z.object({
  date: isoDate,
  amount: money({ positive: true, label: 'o valor pago' }),
});
export type ConfirmPaymentInput = z.output<typeof confirmPaymentInput>;

export const checkpointInput = z.object({
  date: isoDate,
  statementBalance: money({ positive: false, label: 'o saldo que o banco mostra' }),
  applyAdjustment: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
});
export type CheckpointInput = z.output<typeof checkpointInput>;

export const templateInput = z.object({
  type: z.enum(['FIXED', 'RECURRING_VARIABLE'], { error: 'Escolha fixo ou recorrente.' }),
  direction: z.enum(['INCOME', 'EXPENSE'], { error: 'Escolha receita ou despesa.' }),
  description: z
    .string({ error: 'Informe uma descrição.' })
    .trim()
    .min(1, { error: 'Informe uma descrição.' })
    .max(140, { error: 'Descrição muito longa (máx. 140).' }),
  categoryId: uuid('Escolha uma categoria.'),
  amount: money({ positive: true }),
  dayOfMonth: z.coerce
    .number({ error: 'Informe o dia.' })
    .int()
    .min(1, { error: 'Dia entre 1 e 31.' })
    .max(31, { error: 'Dia entre 1 e 31.' }),
  paymentMethod: z.enum([...ACCOUNT_PAYMENT_METHODS, 'CREDIT_CARD'], {
    error: 'Escolha o meio de pagamento.',
  }),
  /** obrigatório quando paymentMethod = CREDIT_CARD (assinatura no cartão) */
  creditCardId: optionalUuid,
  startMonth: monthInput,
  endMonth: z.preprocess(blankToUndefined, monthInput.optional()).transform((v) => v ?? null),
  beneficiaryUserId: optionalUuid,
});
export type TemplateInput = z.output<typeof templateInput>;

export const changeFromInput = templateInput
  .omit({ startMonth: true, endMonth: true, direction: true })
  .extend({ effectiveMonth: monthInput });
export type ChangeFromInput = z.output<typeof changeFromInput>;

export const endTemplateInput = z.object({ lastMonth: monthInput });

// ─────────── cartões (Fase 3) ───────────

const day = (label: string) =>
  z.coerce
    .number({ error: `Informe o dia de ${label}.` })
    .int({ error: `Dia de ${label} entre 1 e 31.` })
    .min(1, { error: `Dia de ${label} entre 1 e 31.` })
    .max(31, { error: `Dia de ${label} entre 1 e 31.` });

const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

/** "Roxinho, nubank" → ['roxinho', 'nubank'] (minúsculas, sem acento), como os aliases das categorias. */
const aliases = z
  .preprocess((v) => (typeof v === 'string' ? v : ''), z.string().max(400))
  .transform((v) =>
    [...new Set(v.split(',').map((a) => a.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()))].filter(
      Boolean,
    ),
  );

export const cardInput = z
  .object({
    name: z
      .string({ error: 'Informe o nome do cartão.' })
      .trim()
      .min(1, { error: 'Informe o nome do cartão.' })
      .max(80),
    issuer: optionalText(60),
    last4: z
      .preprocess(
        blankToUndefined,
        z
          .string()
          .regex(/^\d{4}$/, { error: 'Final do cartão: 4 dígitos.' })
          .optional(),
      )
      .transform((v) => v ?? null),
    isAdditional: checkbox,
    holderName: optionalText(80),
    /** vazio = não rastrear o limite (adicional de terceiro sem sub-limite) */
    limitTotal: z
      .preprocess(blankToUndefined, money({ positive: true, label: 'o limite' }).optional())
      .transform((v) => v ?? null),
    closingDay: day('fechamento'),
    dueDay: day('vencimento'),
    botAliases: aliases,
  })
  .refine((c) => c.closingDay !== c.dueDay, { error: 'Fechamento e vencimento não podem ser no mesmo dia.' })
  .refine((c) => !c.isAdditional || c.holderName !== null, {
    error: 'Informe o titular do cartão adicional.',
  });
export type CardInput = z.output<typeof cardInput>;

const description = z
  .string({ error: 'Informe uma descrição.' })
  .trim()
  .min(1, { error: 'Informe uma descrição.' })
  .max(180, { error: 'Descrição muito longa (máx. 180).' });

export const cardPurchaseInput = z.object({
  cardId: uuid('Escolha o cartão.'),
  amount: money({ positive: true }),
  installments: z.coerce
    .number({ error: 'Informe o número de parcelas.' })
    .int({ error: 'Parcelas: número inteiro.' })
    .min(1, { error: 'Parcelas entre 1 e 72.' })
    .max(72, { error: 'Parcelas entre 1 e 72.' }),
  description,
  categoryId: uuid('Escolha uma categoria.'),
  date: isoDate,
  beneficiaryUserId: optionalUuid,
  notes: optionalText(2000),
});
export type CardPurchaseInput = z.output<typeof cardPurchaseInput>;

export const cardPurchaseEditInput = cardPurchaseInput
  .pick({
    description: true,
    categoryId: true,
    beneficiaryUserId: true,
    notes: true,
  })
  .extend({
    /** novo valor total; ausente = não muda (o formulário só o envia quando a compra permite) */
    amount: money({ positive: true }).optional(),
  });
export type CardPurchaseEditInput = z.output<typeof cardPurchaseEditInput>;

export const onboardingInput = z
  .object({
    cardId: uuid('Escolha o cartão.'),
    description,
    total: money({ positive: true, label: 'o valor total da compra' }),
    installments: z.coerce.number().int().min(2, { error: 'Parcelamento: pelo menos 2 parcelas.' }).max(72),
    currentInstallment: z.coerce
      .number({ error: 'Informe a parcela atual.' })
      .int()
      .min(1, { error: 'Parcela atual inválida.' }),
    purchaseDate: isoDate,
    /** fatura (mês de vencimento) em que a parcela atual cai */
    currentInvoiceMonth: monthInput,
    categoryId: uuid('Escolha uma categoria.'),
    beneficiaryUserId: optionalUuid,
  })
  .refine((o) => o.currentInstallment <= o.installments, {
    error: 'A parcela atual não pode passar do total de parcelas.',
  })
  .refine((o) => o.total >= o.installments, { error: 'Cada parcela precisa ter pelo menos R$ 0,01.' });
export type OnboardingInput = z.output<typeof onboardingInput>;

export const invoicePaymentInput = z.object({
  amount: money({ positive: true, label: 'o valor pago' }),
  date: isoDate,
  paymentMethod: z.enum(['PIX', 'BOLETO', 'AUTO_DEBIT', 'BANK_TRANSFER', 'DEBIT', 'OTHER'], {
    error: 'Escolha como pagou.',
  }),
});
export type InvoicePaymentInput = z.output<typeof invoicePaymentInput>;

export const invoiceDatesInput = z.object({ closingDate: isoDate, dueDate: isoDate });
export type InvoiceDatesInput = z.output<typeof invoiceDatesInput>;

export const anticipationInput = z
  .object({
    itemIds: z.array(z.uuid()).min(1, { error: 'Escolha ao menos uma parcela.' }),
    paid: money({ positive: true, label: 'o valor pago na antecipação' }),
    date: isoDate,
    settlement: z.enum(['ON_INVOICE', 'DIRECT_PAYMENT'], { error: 'Escolha como foi pago.' }),
    targetInvoiceId: optionalUuid,
  })
  .refine((a) => a.settlement !== 'ON_INVOICE' || a.targetInvoiceId !== null, {
    error: 'Escolha a fatura onde a antecipação foi lançada.',
  });
export type AnticipationInput = z.output<typeof anticipationInput>;

export const refundInput = z.object({
  mode: z.enum(['CREDIT_KEEP_INSTALLMENTS', 'CANCEL_PURCHASE'], { error: 'Escolha o tipo de estorno.' }),
  /** Modo A: valor do crédito. Modo B: ignorado (calculado). */
  amount: z
    .preprocess(blankToUndefined, money({ positive: true, label: 'o valor do estorno' }).optional())
    .transform((v) => v ?? null),
  refundDate: isoDate,
  targetInvoiceId: optionalUuid,
  reason: optionalText(500),
});
export type RefundInput = z.output<typeof refundInput>;

/** Primeira mensagem de erro do Zod, para devolver ao usuário. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Dados inválidos.';
}

// ─────────── cartão de benefícios (D65) ───────────

const last4 = z
  .preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^\d{4}$/, { error: 'Final do cartão: 4 dígitos.' })
      .optional(),
  )
  .transform((v) => v ?? null);

const creditDay = z
  .preprocess(
    // campo ausente do formulário (regra "último dia útil") chega como null
    (v) => (v === null ? undefined : blankToUndefined(v)),
    z.coerce
      .number({ error: 'Dia do crédito inválido.' })
      .int({ error: 'Dia do crédito inválido.' })
      .min(1, { error: 'Dia do crédito: de 1 a 31.' })
      .max(31, { error: 'Dia do crédito: de 1 a 31.' })
      .optional(),
  )
  .transform((v) => v ?? null);

const benefitName = (what: string) =>
  z
    .string({ error: `Informe o nome ${what}.` })
    .trim()
    .min(1, { error: `Informe o nome ${what}.` })
    .max(80, { error: 'Nome muito longo (máx. 80).' });

const creditRule = z.enum(['LAST_BUSINESS_DAY', 'DAY_OF_MONTH'], { error: 'Escolha quando o crédito cai.' });

export const benefitWalletInput = z.object({
  name: benefitName('da carteira'),
  monthlyCredit: money({ positive: true, label: 'o crédito mensal' }),
  /** saldo que a carteira já tem hoje (já contando o crédito deste mês, se ele já caiu) */
  openingBalance: z
    .preprocess(blankToUndefined, money({ positive: false, label: 'o saldo atual' }).optional())
    .transform((v) => v ?? 0)
    .refine((v) => v >= 0, { error: 'O saldo atual não pode ser negativo.' }),
});

export const benefitCardInput = z
  .object({
    name: benefitName('do cartão'),
    issuer: optionalText(60),
    last4,
    creditRule,
    creditDay,
    /** primeiro mês com crédito automático */
    startMonth: monthInput,
    wallets: z
      .array(benefitWalletInput)
      .min(1, { error: 'Cadastre pelo menos uma carteira (ex.: Multibenefícios).' })
      .max(MAX_BENEFIT_WALLETS, { error: `No máximo ${MAX_BENEFIT_WALLETS} carteiras por cartão.` }),
  })
  .refine((c) => c.creditRule !== 'DAY_OF_MONTH' || c.creditDay !== null, {
    error: 'Informe o dia do crédito.',
    path: ['creditDay'],
  })
  .refine((c) => new Set(c.wallets.map((w) => w.name.toLowerCase())).size === c.wallets.length, {
    error: 'Duas carteiras com o mesmo nome.',
    path: ['wallets'],
  });
export type BenefitCardInput = z.output<typeof benefitCardInput>;

export const benefitCardUpdateInput = z
  .object({
    name: benefitName('do cartão'),
    issuer: optionalText(60),
    last4,
    creditRule,
    creditDay,
    /** novo crédito mensal de cada carteira (vale para os créditos que ainda não caíram) */
    wallets: z.array(
      z.object({
        id: uuid('Carteira inválida.'),
        monthlyCredit: money({ positive: true, label: 'o crédito mensal' }),
      }),
    ),
  })
  .refine((c) => c.creditRule !== 'DAY_OF_MONTH' || c.creditDay !== null, {
    error: 'Informe o dia do crédito.',
    path: ['creditDay'],
  });
export type BenefitCardUpdateInput = z.output<typeof benefitCardUpdateInput>;

export const benefitSpendInput = z.object({
  walletId: uuid('Escolha a carteira.'),
  amount: money({ positive: true }),
  description: z
    .string({ error: 'Informe uma descrição.' })
    .trim()
    .min(1, { error: 'Informe uma descrição.' })
    .max(200, { error: 'Descrição muito longa (máx. 200).' }),
  categoryId: uuid('Escolha uma categoria.'),
  date: isoDate,
  beneficiaryUserId: optionalUuid,
  notes: optionalText(2000),
});
export type BenefitSpendInput = z.output<typeof benefitSpendInput>;

export const endBenefitInput = z.object({ lastMonth: monthInput });
