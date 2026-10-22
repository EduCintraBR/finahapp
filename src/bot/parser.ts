/**
 * Parser do bot: mensagem curta em pt-BR → um lançamento (despesa ou receita), uma CONSULTA (saldo, limite,
 * pendentes, fatura, gastos…) ou conversa, via Claude com saída estruturada (Zod). O contexto enviado é só a lista de categorias e pessoas — nunca saldos
 * nem histórico (SPEC §7). O valor volta como TEXTO e é convertido para centavos aqui, com o
 * mesmo parseBRL do app; o LLM nunca faz conta de dinheiro.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { compareDates, isISODate, type ISODate } from '@/domain/dates';
import { resolveMonthRef } from '@/domain/month-ref';
import { tryParseBRL, type Cents } from '@/domain/money';
import { ACCOUNT_PAYMENT_METHODS, type AccountPaymentMethod } from '@/lib/labels';

/** O que pedimos ao modelo (sem restrições numéricas: a validação de verdade é feita depois). */
export const llmEntrySchema = z.object({
  is_entry: z.boolean().describe('true só se a mensagem descreve um gasto ou receita para LANÇAR'),
  is_query: z
    .boolean()
    .describe('true se é uma PERGUNTA sobre as finanças (saldo, limite, contas pendentes, fatura, gastos…)'),
  query_type: z
    .enum(['BALANCE', 'LIMIT', 'PENDING', 'INVOICE', 'SPENDING', 'MONTH_SUMMARY', 'RECENT'])
    .nullable()
    .describe('tipo da pergunta, quando is_query = true; senão null'),
  query_card_id: z.string().nullable().describe('id do cartão da lista, se a pergunta citar um cartão'),
  query_category_id: z.string().nullable().describe('id da categoria da lista, se a pergunta citar uma'),
  month_offset: z
    .number()
    .nullable()
    .describe('0 = mês atual, 1 = mês que vem, -1 = mês passado; null se não citou mês relativo'),
  month_number: z.number().nullable().describe('1 a 12 se a pergunta citar o nome de um mês; senão null'),
  year: z.number().nullable().describe('ano (4 dígitos) se a pergunta citar o ano; senão null'),
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

/** Pergunta já validada: ids conhecidos e mês resolvido (month null = mês atual; para fatura sem mês = a aberta). */
export type BotQuery =
  | { type: 'BALANCE' }
  | { type: 'LIMIT'; cardId: string | null }
  | { type: 'PENDING'; month: ISODate | null }
  | { type: 'INVOICE'; cardId: string | null; month: ISODate | null }
  | { type: 'SPENDING'; month: ISODate | null; categoryId: string | null }
  | { type: 'MONTH_SUMMARY'; month: ISODate | null }
  | { type: 'RECENT' };

/** Resultado já validado e normalizado (centavos, ids conhecidos, data válida). */
export type ParsedEntry =
  | { ok: false; reason: 'not_entry' }
  | { ok: true; kind: 'QUERY'; query: BotQuery }
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

/** Pergunta do LLM → consulta com ids conhecidos e mês resolvido; null se não deu para entender. */
function normalizeQuery(raw: LlmEntry, ctx: ParseContext): BotQuery | null {
  const card = ctx.cards.find((c) => c.id === raw.query_card_id);
  const category = ctx.categories.find((c) => c.id === raw.query_category_id);
  const month = resolveMonthRef(
    { offset: raw.month_offset, month: raw.month_number, year: raw.year },
    ctx.today,
  );
  switch (raw.query_type) {
    case 'BALANCE':
    case 'RECENT':
      return { type: raw.query_type };
    case 'LIMIT':
      return { type: 'LIMIT', cardId: card?.id ?? null };
    case 'PENDING':
      return { type: 'PENDING', month };
    case 'INVOICE':
      return {
        type: 'INVOICE',
        cardId: card?.id ?? (ctx.cards.length === 1 ? ctx.cards[0]!.id : null),
        month,
      };
    case 'SPENDING':
      return { type: 'SPENDING', month, categoryId: category?.id ?? null };
    case 'MONTH_SUMMARY':
      return { type: 'MONTH_SUMMARY', month };
    default:
      return null;
  }
}

/** Valida e normaliza a saída do LLM contra o contexto. Pura — testada sem rede. */
export function normalizeLlmEntry(raw: LlmEntry, ctx: ParseContext): ParsedEntry {
  if (!raw.is_entry) {
    const query = raw.is_query ? normalizeQuery(raw, ctx) : null;
    return query ? { ok: true, kind: 'QUERY', query } : { ok: false, reason: 'not_entry' };
  }

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

const SYSTEM_PROMPT = `Você lê mensagens curtas em português do Brasil, enviadas por um casal que controla a conta da casa, e decide se é (1) um LANÇAMENTO de gasto ou receita, (2) uma PERGUNTA sobre as finanças ou (3) conversa.

Decida primeiro:
- Lançamento ("mercado 180 no pix", "recebi 5000 de salário"): is_entry = true, is_query = false.
- Pergunta ("quanto tenho de limite?", "o que falta pagar esse mês?", "fatura do nubank"): is_entry = false, is_query = true e preencha query_type.
- Saudação, agradecimento ou qualquer outra coisa: is_entry = false e is_query = false.

Para LANÇAMENTO:
- "kind": EXPENSE para gasto; INCOME para dinheiro que ENTROU ("recebi", "caiu", "salário", "me pagaram", "pix recebido", "reembolso").
- "amount": copie o valor exatamente como o usuário escreveu (ex.: "180", "12,50", "1.234,56"). Não converta, não arredonde, não some.
- "category_id": escolha pelo id da lista de categorias do mesmo tipo (despesa/receita), usando o nome e os apelidos. Se nenhuma servir com segurança, use null.
- "payment_method": PIX, DEBIT (débito), CASH (dinheiro/espécie), BOLETO, BANK_TRANSFER (TED/transferência), AUTO_DEBIT (débito automático), CREDIT_CARD (cartão de crédito: "no crédito", o nome ou apelido de um cartão da lista, ou compra parcelada), OTHER. Se não foi dito, use null. Receita nunca é CREDIT_CARD.
- "card_id": se for cartão de crédito, o id do cartão da lista (pelo nome ou apelido). Se não der para saber qual, null.
- "installments": número de parcelas se a mensagem disser ("em 3x", "3 vezes"); à vista = null.
- "date": só se a mensagem citar a data ("ontem", "dia 12"); converta para AAAA-MM-DD usando a data de hoje informada. Caso contrário, null.
- "beneficiary_user_id": só se a mensagem disser de quem é o gasto ou a receita ("pra Viviane", "meu"). "meu"/"minha" = quem enviou. Senão, null (do casal).
- "confidence": baixa se o valor, a categoria ou o meio de pagamento forem incertos.

Para PERGUNTA, "query_type":
- BALANCE: saldo da conta ("quanto tenho?", "meu saldo").
- LIMIT: limite disponível dos cartões ("limite do nubank", "quanto sobra de limite").
- PENDING: contas a pagar/receber pendentes ("o que falta pagar?", "contas do mês", "pendentes de novembro").
- INVOICE: fatura de um cartão ("fatura do nubank", "resumo da fatura de outubro").
- SPENDING: quanto se gastou ("quanto gastei esse mês?", "gastos com mercado em setembro"); se citar uma categoria, preencha query_category_id.
- MONTH_SUMMARY: resumo do mês (entrou, saiu, o que falta).
- RECENT: últimos lançamentos ("o que lancei por último?").
- Se citar um cartão, preencha query_card_id com o id da lista.
- Mês: sem mês citado, deixe month_offset, month_number e year como null (vale o mês atual). "esse mês" = month_offset 0; "mês que vem"/"próximo mês" = 1; "mês passado" = -1; um nome de mês ("novembro") = month_number (1 a 12), e year só se o ano for citado.
- Em pergunta, os campos de lançamento ficam null (kind = EXPENSE, description vazia, confidence = 100).`;

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

/**
 * Haiku 5.5: ler uma linha de gasto é extração simples, e o bot roda em toda mensagem. Não tem fallback de recusa
 * no servidor (por isso não está em SERVER_FALLBACK_MODELS) e não aceita temperature/top_p/top_k: não enviamos.
 */
export const DEFAULT_LLM_MODEL = 'claude-haiku-5-5';

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
