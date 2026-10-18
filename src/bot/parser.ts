/**
 * Parser do bot: mensagem curta em pt-BR → campos de um lançamento, via Claude com saída
 * estruturada (Zod). O contexto enviado é só a lista de categorias e pessoas — nunca saldos
 * nem histórico (SPEC §7). O valor volta como TEXTO e é convertido para centavos aqui, com o
 * mesmo parseBRL do app; o LLM nunca faz conta de dinheiro.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { compareDates, isISODate, type ISODate } from '@/domain/dates';
import { tryParseBRL, type Cents } from '@/domain/money';
import { ACCOUNT_PAYMENT_METHODS, type AccountPaymentMethod } from '@/lib/labels';

/** O que pedimos ao modelo (sem restrições numéricas: a validação de verdade é feita depois). */
export const llmEntrySchema = z.object({
  is_entry: z.boolean().describe('false se a mensagem não descreve um gasto ou receita'),
  kind: z.enum(['EXPENSE', 'INCOME']),
  amount: z.string().nullable().describe('valor exatamente como escrito, ex.: "180", "12,50", "1.234,56"'),
  description: z.string().describe('descrição curta, ex.: "Mercado", "Uber"'),
  category_id: z.string().nullable().describe('id da categoria da lista, ou null se nenhuma servir'),
  payment_method: z.enum([...ACCOUNT_PAYMENT_METHODS, 'CREDIT_CARD']).nullable(),
  card_id: z.string().nullable().describe('id do cartão da lista, se for compra no cartão de crédito'),
  installments: z.number().nullable().describe('número de parcelas, se mencionado'),
  date: z.string().nullable().describe('AAAA-MM-DD se a data foi mencionada; null = hoje'),
  beneficiary_user_id: z
    .string()
    .nullable()
    .describe('id da pessoa de quem é o gasto, se mencionado; null = casal'),
  confidence: z.number().describe('0 a 100: certeza de que todos os campos estão corretos'),
});
export type LlmEntry = z.infer<typeof llmEntrySchema>;

export type ParseContext = {
  today: ISODate;
  senderName: string;
  categories: { id: string; name: string; kind: 'EXPENSE' | 'INCOME'; botAliases: string[] }[];
  users: { id: string; name: string }[];
  cards: { id: string; name: string; botAliases: string[] }[];
};

/** Resultado já validado e normalizado (centavos, ids conhecidos, data válida). */
export type ParsedEntry =
  | { ok: false; reason: 'not_entry' }
  | {
      ok: true;
      kind: 'EXPENSE' | 'INCOME';
      amountCents: Cents | null;
      amountError: string | null;
      description: string;
      categoryId: string | null;
      paymentMethod: AccountPaymentMethod | 'CREDIT_CARD' | null;
      /** cartão identificado (só com paymentMethod = CREDIT_CARD) */
      cardId: string | null;
      installments: number | null;
      date: ISODate;
      beneficiaryUserId: string | null;
      confidence: number;
    };

export type EntryParser = (text: string, ctx: ParseContext) => Promise<ParsedEntry>;

export class ParserUnavailableError extends Error {
  override name = 'ParserUnavailableError';
}

/** Valida e normaliza a saída do LLM contra o contexto. Pura — testada sem rede. */
export function normalizeLlmEntry(raw: LlmEntry, ctx: ParseContext): ParsedEntry {
  if (!raw.is_entry) return { ok: false, reason: 'not_entry' };

  let amountCents: Cents | null = null;
  let amountError: string | null = 'Não encontrei o valor.';
  if (raw.amount) {
    const r = tryParseBRL(raw.amount);
    if (r.ok && r.value > 0) {
      amountCents = r.value;
      amountError = null;
    } else {
      amountError = r.ok ? 'O valor precisa ser maior que zero.' : r.error;
    }
  }

  const category = ctx.categories.find((c) => c.id === raw.category_id && c.kind === raw.kind);
  const beneficiary = ctx.users.find((u) => u.id === raw.beneficiary_user_id);
  const date =
    raw.date && isISODate(raw.date) && compareDates(raw.date, ctx.today) <= 0 ? raw.date : ctx.today;
  const confidence = Math.max(
    0,
    Math.min(100, Math.round(Number.isFinite(raw.confidence) ? raw.confidence : 0)),
  );
  const installments =
    raw.installments !== null && Number.isInteger(raw.installments) && raw.installments > 1
      ? raw.installments
      : null;
  // parcelado implica cartão; com um cartão só, não há o que escolher
  const paymentMethod = installments ? 'CREDIT_CARD' : raw.payment_method;
  const card =
    paymentMethod === 'CREDIT_CARD'
      ? (ctx.cards.find((c) => c.id === raw.card_id) ?? (ctx.cards.length === 1 ? ctx.cards[0] : undefined))
      : undefined;

  return {
    ok: true,
    kind: raw.kind,
    amountCents,
    amountError,
    description: raw.description.trim().slice(0, 200) || 'Lançamento pelo bot',
    categoryId: category?.id ?? null,
    paymentMethod,
    cardId: card?.id ?? null,
    installments,
    date,
    beneficiaryUserId: beneficiary?.id ?? null,
    confidence,
  };
}

const SYSTEM_PROMPT = `Você extrai lançamentos financeiros de mensagens curtas em português do Brasil, enviadas por um casal que controla a conta da casa.

Regras:
- "amount": copie o valor exatamente como o usuário escreveu (ex.: "180", "12,50", "1.234,56"). Não converta, não arredonde, não some.
- "category_id": escolha pelo id da lista de categorias do mesmo tipo (despesa/receita), usando o nome e os apelidos. Se nenhuma servir com segurança, use null.
- "payment_method": PIX, DEBIT (débito), CASH (dinheiro/espécie), BOLETO, BANK_TRANSFER (TED/transferência), AUTO_DEBIT (débito automático), CREDIT_CARD (cartão de crédito: "no crédito", o nome ou apelido de um cartão da lista, ou compra parcelada), OTHER. Se não foi dito, use null.
- "card_id": se for cartão de crédito, o id do cartão da lista (pelo nome ou apelido). Se não der para saber qual, null.
- "installments": número de parcelas se a mensagem disser ("em 3x", "3 vezes"); à vista = null.
- "date": só se a mensagem citar a data ("ontem", "dia 12"); converta para AAAA-MM-DD usando a data de hoje informada. Caso contrário, null.
- "beneficiary_user_id": só se a mensagem disser de quem é o gasto ("pra Viviane", "meu"). "meu"/"minha" = quem enviou. Senão, null (gasto do casal).
- "confidence": baixa se o valor, a categoria ou o meio de pagamento forem incertos.
- Se a mensagem não for um lançamento (saudação, pergunta etc.), "is_entry" = false.`;

function contextMessage(text: string, ctx: ParseContext): string {
  const aliases = (a: string[]) => (a.length ? ` (${a.join(', ')})` : '');
  const cats = ctx.categories
    .map(
      (c) =>
        `- ${c.id} | ${c.kind === 'EXPENSE' ? 'despesa' : 'receita'} | ${c.name}${aliases(c.botAliases)}`,
    )
    .join('\n');
  const people = ctx.users.map((u) => `- ${u.id} | ${u.name}`).join('\n');
  const cards = ctx.cards.length
    ? ctx.cards.map((c) => `- ${c.id} | ${c.name}${aliases(c.botAliases)}`).join('\n')
    : '(nenhum)';
  return [
    `Hoje: ${ctx.today}`,
    `Quem enviou: ${ctx.senderName}`,
    '',
    'Pessoas:',
    people,
    '',
    'Cartões:',
    cards,
    '',
    'Categorias:',
    cats,
    '',
    'Mensagem:',
    text,
  ].join('\n');
}

/** Modelos que aceitam o fallback de recusa no servidor (`fallbacks: "default"`). */
const SERVER_FALLBACK_MODELS = new Set([
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-fable-5-1',
  'claude-sonnet-5-5',
]);

export const DEFAULT_LLM_MODEL = 'claude-opus-5-5';

/** Parser real (Claude). `client` injetável para testes. */
export function createClaudeParser(opts: { model?: string; client?: Anthropic } = {}): EntryParser {
  const model = opts.model || process.env.LLM_MODEL || DEFAULT_LLM_MODEL;
  const client = opts.client ?? new Anthropic();

  return async (text, ctx) => {
    const useFallback = SERVER_FALLBACK_MODELS.has(model);
    try {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: contextMessage(text, ctx) }],
        output_config: { effort: 'low', format: betaZodOutputFormat(llmEntrySchema) },
        ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        throw new ParserUnavailableError(`Resposta sem dados (stop_reason=${response.stop_reason}).`);
      }
      return normalizeLlmEntry(response.parsed_output, ctx);
    } catch (err) {
      if (err instanceof ParserUnavailableError) throw err;
      if (err instanceof Anthropic.APIError) {
        throw new ParserUnavailableError(`Anthropic API ${err.status ?? ''}: ${err.message}`);
      }
      throw err;
    }
  };
}
