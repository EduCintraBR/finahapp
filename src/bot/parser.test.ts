import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  createClaudeParser,
  normalizeLlmEntry,
  ParserUnavailableError,
  type LlmEntry,
  type ParseContext,
} from './parser';

const ctx: ParseContext = {
  today: '2026-10-17',
  senderName: 'Eduardo',
  categories: [
    { id: 'cat-mercado', name: 'Mercado', kind: 'EXPENSE', botAliases: ['mercado', 'super'] },
    { id: 'cat-salario', name: 'Salário CLT', kind: 'INCOME', botAliases: ['salario'] },
  ],
  users: [
    { id: 'u-edu', name: 'Eduardo' },
    { id: 'u-viv', name: 'Viviane' },
  ],
  cards: [
    { id: 'card-edu', name: 'Nubank Eduardo', botAliases: ['nubank', 'roxinho'] },
    { id: 'card-mae', name: 'Nubank adicional', botAliases: ['adicional'] },
  ],
};

const raw = (over: Partial<LlmEntry> = {}): LlmEntry => ({
  is_entry: true,
  is_query: false,
  query_type: null,
  query_card_id: null,
  query_category_id: null,
  month_offset: null,
  month_number: null,
  year: null,
  kind: 'EXPENSE',
  amount: '180',
  description: 'Mercado',
  category_id: 'cat-mercado',
  payment_method: 'PIX',
  card_id: null,
  installments: null,
  date: null,
  beneficiary_user_id: null,
  confidence: 95,
  ...over,
});

describe('normalizeLlmEntry', () => {
  it('converte o valor com o parseBRL do app (nunca float)', () => {
    expect(normalizeLlmEntry(raw({ amount: '1.234,56' }), ctx)).toMatchObject({
      ok: true,
      amountCents: 123456,
    });
    expect(normalizeLlmEntry(raw({ amount: '12.5' }), ctx)).toMatchObject({ amountCents: 1250 });
  });

  it('valor inválido ou ausente vira erro, não chute', () => {
    expect(normalizeLlmEntry(raw({ amount: '12,345' }), ctx)).toMatchObject({
      amountCents: null,
      amountError: expect.stringContaining('inválido'),
    });
    expect(normalizeLlmEntry(raw({ amount: null }), ctx)).toMatchObject({ amountCents: null });
    expect(normalizeLlmEntry(raw({ amount: '0' }), ctx)).toMatchObject({ amountCents: null });
  });

  it('descarta ids inventados e categoria do tipo errado', () => {
    expect(normalizeLlmEntry(raw({ category_id: 'inventado' }), ctx)).toMatchObject({ categoryId: null });
    expect(normalizeLlmEntry(raw({ category_id: 'cat-salario' }), ctx)).toMatchObject({ categoryId: null });
    expect(normalizeLlmEntry(raw({ beneficiary_user_id: 'u-xyz' }), ctx)).toMatchObject({
      beneficiaryUserId: null,
    });
    expect(normalizeLlmEntry(raw({ beneficiary_user_id: 'u-viv' }), ctx)).toMatchObject({
      beneficiaryUserId: 'u-viv',
    });
  });

  it('data: inválida ou futura vira hoje', () => {
    expect(normalizeLlmEntry(raw({ date: '2026-10-16' }), ctx)).toMatchObject({ date: '2026-10-16' });
    expect(normalizeLlmEntry(raw({ date: '2026-10-18' }), ctx)).toMatchObject({ date: '2026-10-17' });
    expect(normalizeLlmEntry(raw({ date: 'ontem' }), ctx)).toMatchObject({ date: '2026-10-17' });
  });

  it('confiança limitada a 0..100 e parcelas só se > 1', () => {
    expect(normalizeLlmEntry(raw({ confidence: 140 }), ctx)).toMatchObject({ confidence: 100 });
    expect(normalizeLlmEntry(raw({ confidence: -3 }), ctx)).toMatchObject({ confidence: 0 });
    expect(normalizeLlmEntry(raw({ installments: 1 }), ctx)).toMatchObject({ installments: null });
    expect(normalizeLlmEntry(raw({ installments: 3 }), ctx)).toMatchObject({ installments: 3 });
  });

  it('cartão: id conhecido; inventado vira null; parcelado implica cartão', () => {
    expect(normalizeLlmEntry(raw({ payment_method: 'CREDIT_CARD', card_id: 'card-edu' }), ctx)).toMatchObject(
      { cardId: 'card-edu' },
    );
    expect(normalizeLlmEntry(raw({ payment_method: 'CREDIT_CARD', card_id: 'x' }), ctx)).toMatchObject({
      cardId: null,
    });
    expect(
      normalizeLlmEntry(raw({ payment_method: null, installments: 3, card_id: 'card-mae' }), ctx),
    ).toMatchObject({
      paymentMethod: 'CREDIT_CARD',
      cardId: 'card-mae',
      installments: 3,
    });
    expect(normalizeLlmEntry(raw({ payment_method: 'PIX', card_id: 'card-edu' }), ctx)).toMatchObject({
      cardId: null,
    });
  });

  it('com um cartão só, "no crédito" já sabe qual', () => {
    const one = { ...ctx, cards: [ctx.cards[0]!] };
    expect(normalizeLlmEntry(raw({ payment_method: 'CREDIT_CARD', card_id: null }), one)).toMatchObject({
      cardId: 'card-edu',
    });
  });

  it('mensagem que não é lançamento', () => {
    expect(normalizeLlmEntry(raw({ is_entry: false }), ctx)).toEqual({ ok: false, reason: 'not_entry' });
  });
});

describe('normalizeLlmEntry: perguntas', () => {
  const ask = (over: Partial<LlmEntry>) =>
    normalizeLlmEntry(raw({ is_entry: false, is_query: true, ...over }), ctx);

  it('pergunta vira consulta; sem mês dito = mês atual (month null)', () => {
    expect(ask({ query_type: 'BALANCE' })).toEqual({ ok: true, kind: 'QUERY', query: { type: 'BALANCE' } });
    expect(ask({ query_type: 'PENDING' })).toMatchObject({ query: { type: 'PENDING', month: null } });
    expect(ask({ query_type: 'RECENT' })).toMatchObject({ query: { type: 'RECENT' } });
  });

  it('resolve o mês pelo texto do modelo: relativo, nome do mês (sem ano = ano de hoje) e ano', () => {
    expect(ask({ query_type: 'PENDING', month_offset: 1 })).toMatchObject({ query: { month: '2026-11-01' } });
    expect(ask({ query_type: 'PENDING', month_offset: -1 })).toMatchObject({
      query: { month: '2026-09-01' },
    });
    expect(ask({ query_type: 'PENDING', month_number: 12 })).toMatchObject({
      query: { month: '2026-12-01' },
    });
    expect(ask({ query_type: 'PENDING', month_number: 1, year: 2027 })).toMatchObject({
      query: { month: '2027-01-01' },
    });
    expect(ask({ query_type: 'PENDING', month_number: 13 })).toMatchObject({ query: { month: null } });
  });

  it('cartão e categoria só valem se existirem na lista; fatura com um cartão só usa esse', () => {
    expect(ask({ query_type: 'LIMIT', query_card_id: 'card-edu' })).toMatchObject({
      query: { cardId: 'card-edu' },
    });
    expect(ask({ query_type: 'LIMIT', query_card_id: 'inventado' })).toMatchObject({
      query: { cardId: null },
    });
    expect(ask({ query_type: 'SPENDING', query_category_id: 'cat-mercado' })).toMatchObject({
      query: { categoryId: 'cat-mercado' },
    });
    expect(ask({ query_type: 'SPENDING', query_category_id: 'inventado' })).toMatchObject({
      query: { categoryId: null },
    });
    // dois cartões e nenhum citado: não chuta
    expect(ask({ query_type: 'INVOICE' })).toMatchObject({ query: { type: 'INVOICE', cardId: null } });
    const one = { ...ctx, cards: [ctx.cards[0]!] };
    expect(
      normalizeLlmEntry(raw({ is_entry: false, is_query: true, query_type: 'INVOICE' }), one),
    ).toMatchObject({
      query: { cardId: 'card-edu' },
    });
  });

  it('pergunta sem tipo, ou nem lançamento nem pergunta, não é nada', () => {
    expect(ask({ query_type: null })).toEqual({ ok: false, reason: 'not_entry' });
    expect(normalizeLlmEntry(raw({ is_entry: false, is_query: false }), ctx)).toEqual({
      ok: false,
      reason: 'not_entry',
    });
  });

  it('lançamento tem prioridade sobre pergunta (mensagem ambígua não vira consulta)', () => {
    expect(
      normalizeLlmEntry(raw({ is_entry: true, is_query: true, query_type: 'BALANCE' }), ctx),
    ).toMatchObject({
      ok: true,
      kind: 'EXPENSE',
    });
  });
});

function fakeClient(response: unknown) {
  const parse = vi.fn().mockResolvedValue(response);
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

describe('createClaudeParser', () => {
  it('pede saída estruturada, esforço baixo e fallback de recusa; não envia saldos', async () => {
    const { client, parse } = fakeClient({ stop_reason: 'end_turn', parsed_output: raw() });
    const parser = createClaudeParser({ model: 'claude-opus-5-5', client });
    const r = await parser('mercado 180 no pix', ctx);
    expect(r).toMatchObject({ ok: true, amountCents: 18000, categoryId: 'cat-mercado' });

    const params = parse.mock.calls[0]![0];
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.output_config.effort).toBe('low');
    expect(params.output_config.format).toBeDefined();
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    const userText = params.messages[0].content as string;
    expect(userText).toContain('mercado 180 no pix');
    expect(userText).toContain('cat-mercado');
    expect(userText).toContain('roxinho');
    expect(userText.toLowerCase()).not.toContain('saldo');
  });

  it('o padrão é o Haiku 5.5: esforço baixo, sem fallback, sem parâmetros de amostragem', async () => {
    const saved = process.env.LLM_MODEL;
    delete process.env.LLM_MODEL;
    try {
      const { client, parse } = fakeClient({ stop_reason: 'end_turn', parsed_output: raw() });
      await createClaudeParser({ client })('mercado 180 no pix', ctx);
      const params = parse.mock.calls[0]![0];
      expect(params.model).toBe('claude-haiku-5-5');
      expect(params.output_config.effort).toBe('low');
      // o Haiku 5.5 recusa (400) temperature/top_p/top_k diferentes do padrão e prefill, e não tem fallback
      for (const k of ['temperature', 'top_p', 'top_k', 'fallbacks', 'betas'])
        expect(params).not.toHaveProperty(k);
      expect(params.messages.at(-1).role).toBe('user');
    } finally {
      if (saved !== undefined) process.env.LLM_MODEL = saved;
    }
  });

  it('modelo sem fallback no servidor não recebe o parâmetro', async () => {
    const { client, parse } = fakeClient({ stop_reason: 'end_turn', parsed_output: raw() });
    await createClaudeParser({ model: 'claude-haiku-5-5', client })('x', ctx);
    expect(parse.mock.calls[0]![0].fallbacks).toBeUndefined();
  });

  it('recusa ou saída vazia → ParserUnavailableError', async () => {
    const refused = fakeClient({ stop_reason: 'refusal', parsed_output: null });
    await expect(createClaudeParser({ client: refused.client })('x', ctx)).rejects.toBeInstanceOf(
      ParserUnavailableError,
    );
  });
});
