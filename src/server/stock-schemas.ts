/**
 * Validação de entrada do estoque da Casa (D81 a D83), com mensagens em pt-BR. Peso e volume chegam como texto
 * numa unidade ("1,8" + kg) e saem inteiros na unidade-base (g, ml), sem float.
 */
import { z } from 'zod';
import { isISODate } from '@/domain/dates';
import { MAX_PACKAGES } from '@/domain/stock/quantity';
import { tryParseAmount, type MeasureUnit } from '@/domain/stock/measure';

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalText = (max: number, label: string) =>
  z
    .preprocess(
      blank,
      z
        .string()
        .trim()
        .max(max, { error: `${label} pode ter até ${max} caracteres.` })
        .optional(),
    )
    .transform((v) => v ?? null);
const optionalId = z.preprocess(blank, z.uuid().optional()).transform((v) => v ?? null);
const name = (max: number) =>
  z
    .string({ error: 'Informe o nome.' })
    .trim()
    .min(1, { error: 'Informe o nome.' })
    .max(max, { error: `O nome pode ter até ${max} caracteres.` });
const date = (label: string) =>
  z.string({ error: `Informe a data ${label}.` }).refine(isISODate, { error: `Data ${label} inválida.` });
const optionalDate = (label: string) =>
  z
    .preprocess(
      blank,
      z
        .string()
        .refine(isISODate, { error: `Data ${label} inválida.` })
        .optional(),
    )
    .transform((v) => v ?? null);

const measure = z.enum(['UNIT', 'WEIGHT', 'VOLUME'], { error: 'Escolha como contar o produto.' });
const unit = z.enum(['un', 'g', 'kg', 'ml', 'L']).default('un');

/** Número inteiro de embalagens digitado ("3"). */
const packages = (label: string) =>
  z.preprocess(
    blank,
    z.coerce
      .number({ error: `Informe ${label}.` })
      .int({ error: `${label[0]!.toUpperCase()}${label.slice(1)} é um número inteiro.` })
      .min(1, { error: `${label[0]!.toUpperCase()}${label.slice(1)} precisa ser maior que zero.` })
      .max(MAX_PACKAGES, { error: 'Quantidade alta demais.' }),
  );

/** Quantidade opcional na unidade escolhida → inteiro na unidade-base (ou null). */
function amountOrNull(text: string | undefined, u: MeasureUnit, label: string, ctx: z.RefinementCtx) {
  if (text === undefined) return null;
  const r = tryParseAmount(text, u);
  if (!r.ok) {
    ctx.addIssue({ code: 'custom', message: `${label}: ${r.error}` });
    return z.NEVER;
  }
  return r.value;
}
const amountText = z.preprocess(blank, z.string().optional());

/** Número de meses opcional (prazo de envase, conferência periódica). */
const months = (label: string, max: number) =>
  z
    .preprocess(
      blank,
      z.coerce
        .number()
        .int({ error: `${label} é um número inteiro de meses.` })
        .min(1, { error: `${label} precisa ser de pelo menos 1 mês.` })
        .max(max, { error: `${label} pode ser de até ${max} meses.` })
        .optional(),
    )
    .transform((v) => v ?? null);

// ─────────── categorias e locais ───────────

export const stockCategoryInput = z.object({ name: name(60), parentId: optionalId });
export const stockRenameInput = z.object({ id: z.uuid(), name: name(60) });
export const stockLocationInput = z.object({ name: name(60) });
export const idInput = z.object({ id: z.uuid() });

// ─────────── produto ───────────

export const stockProductInput = z
  .object({
    name: name(80),
    categoryId: z.uuid({ error: 'Escolha a categoria.' }),
    defaultLocationId: optionalId,
    measure,
    prefix: z
      .preprocess(blank, z.string().trim().toUpperCase().optional())
      .refine((v) => v === undefined || /^[A-Z0-9]{2,4}$/.test(v), {
        error: 'O código precisa ter de 2 a 4 letras ou números (ex.: ARR).',
      })
      .transform((v) => v ?? null),
    minText: amountText,
    targetText: amountText,
    minUnit: unit,
    targetUnit: unit,
    defaultPackage: optionalText(40, 'A embalagem'),
    defaultContentText: amountText,
    contentUnit: unit,
    expiryKind: z.enum(['EXPIRY', 'REPLACE_BY']).default('EXPIRY'),
    repackShelfLifeMonths: months('O prazo depois de envasado', 240),
    checkEveryMonths: months('A conferência', 60),
    notes: optionalText(500, 'A observação'),
  })
  .transform(
    ({ minText, minUnit, targetText, targetUnit, defaultContentText, contentUnit, ...rest }, ctx) => {
      const minQuantity = amountOrNull(minText, minUnit, 'Estoque mínimo', ctx);
      const targetQuantity = amountOrNull(targetText, targetUnit, 'Meta', ctx);
      const defaultContent = amountOrNull(defaultContentText, contentUnit, 'Conteúdo', ctx);
      if (minQuantity !== null && targetQuantity !== null && targetQuantity < minQuantity) {
        ctx.addIssue({ code: 'custom', message: 'A meta não pode ser menor que o estoque mínimo.' });
        return z.NEVER;
      }
      return { ...rest, minQuantity, targetQuantity, defaultContent };
    },
  );
export type StockProductInput = z.output<typeof stockProductInput>;

// ─────────── lote (entrada) ───────────

const lotFields = {
  packageName: z
    .string({ error: 'Informe a embalagem.' })
    .trim()
    .min(1, { error: 'Informe a embalagem (pacote, garrafa, galão…).' })
    .max(40, { error: 'A embalagem pode ter até 40 caracteres.' }),
  contentText: amountText,
  contentUnit: unit,
  locationId: optionalId,
  entryDate: date('de entrada'),
  expiryDate: optionalDate('de validade'),
  notes: optionalText(500, 'A observação'),
};

const withContent = <T extends { contentText?: string; contentUnit: MeasureUnit }>(
  { contentText, contentUnit, ...rest }: T,
  ctx: z.RefinementCtx,
) => ({
  ...rest,
  contentPerPackage: amountOrNull(contentText, contentUnit, 'Conteúdo de cada embalagem', ctx),
});

export const stockLotInput = z
  .object({
    productId: z.uuid({ error: 'Escolha o produto.' }),
    packages: packages('a quantidade'),
    ...lotFields,
  })
  .transform(withContent);
export type StockLotInput = z.output<typeof stockLotInput>;

export const stockLotUpdateInput = z.object({ id: z.uuid(), ...lotFields }).transform(withContent);
export type StockLotUpdateInput = z.output<typeof stockLotUpdateInput>;

// ─────────── saídas, contagem e desfazer ───────────

export const stockUseInput = z.object({
  productId: z.uuid(),
  kind: z.enum(['USE', 'DISCARD']),
  packages: packages('a quantidade'),
  /** vazio = automático: o que vence primeiro (FEFO) */
  lotId: optionalId,
  date: date('do movimento'),
  notes: optionalText(500, 'A observação'),
});
export type StockUseInput = z.output<typeof stockUseInput>;

export const stockCountInput = z.object({
  lotId: z.uuid(),
  counted: z.preprocess(
    blank,
    z.coerce
      .number({ error: 'Informe quantas embalagens tem.' })
      .int({ error: 'A contagem é um número inteiro.' })
      .min(0, { error: 'A contagem não pode ser negativa.' })
      .max(MAX_PACKAGES, { error: 'Quantidade alta demais.' }),
  ),
  date: date('da contagem'),
  notes: optionalText(500, 'A observação'),
});
export type StockCountInput = z.output<typeof stockCountInput>;

// ─────────── envase e conferência (D84, D85) ───────────

/**
 * Envase: de quais lotes saem quantas embalagens (`sources`) e o lote envasado que nasce (garrafas, conteúdo de
 * cada uma, local, selagem e validade). Validade em branco = selagem + prazo do produto.
 */
export const stockRepackInput = z
  .object({
    productId: z.uuid(),
    sources: z
      .array(
        z.object({
          lotId: z.uuid(),
          packages: z.coerce.number({ error: 'Quantidade inválida.' }).int().min(0),
        }),
      )
      .max(50),
    packages: packages('quantas embalagens saíram do envase'),
    packageName: lotFields.packageName,
    contentText: amountText,
    contentUnit: unit,
    locationId: optionalId,
    sealDate: date('de selagem'),
    expiryDate: optionalDate('de validade'),
    notes: optionalText(500, 'A observação'),
  })
  .transform(withContent);
export type StockRepackInput = z.output<typeof stockRepackInput>;

export const stockCheckInput = z.object({
  lotId: z.uuid(),
  date: date('da conferência'),
  notes: optionalText(500, 'A observação'),
});
export type StockCheckInput = z.output<typeof stockCheckInput>;
