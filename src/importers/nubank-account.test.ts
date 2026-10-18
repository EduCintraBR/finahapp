import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyAccountLine, counterparty } from './nubank-account';
import { decodeOfx, parseOfx } from './ofx';

const statement = () =>
  parseOfx(decodeOfx(readFileSync(join(process.cwd(), 'tests/fixtures/nubank-account.ofx'))));
const owners = ['eduardo', 'viviane'];

describe('OFX da conta Nubank', () => {
  it('lê como conta corrente, UTF-8, com período e saldo', () => {
    const s = statement();
    expect(s).toMatchObject({
      account: 'BANK',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-17',
      ledgerBalanceCents: 556_594,
    });
    expect(s.transactions).toHaveLength(12);
    expect(s.transactions[0]!.memo).toContain('Transferência enviada pelo Pix');
  });

  it('classifica cada tipo de linha (D45–D47)', () => {
    const lines = statement().transactions.map((t) => classifyAccountLine(t, owners));
    expect(lines.map((l) => [l.description, l.direction, l.suggestedKind, l.paymentMethod])).toEqual([
      ['RECEITA FEDERAL', 'OUT', 'EXPENSE', 'PIX'],
      ['Eduardo Teste Silva', 'IN', 'TRANSFER', 'PIX'],
      ['Aplicação RDB', 'OUT', 'TRANSFER', 'OTHER'],
      ['Resgate RDB', 'IN', 'TRANSFER', 'OTHER'],
      ['MERCEARIA EXEMPLO', 'OUT', 'EXPENSE', 'DEBIT'],
      ['Viviane Teste', 'OUT', 'TRANSFER', 'PIX'],
      ['iFood Delivery', 'OUT', 'EXPENSE', 'DEBIT'],
      ['12.345.678 EDUARDO TESTE', 'IN', 'INCOME', 'BANK_TRANSFER'], // MEI com CNPJ: receita, não transferência
      ['JOAO PROPRIETARIO', 'OUT', 'EXPENSE', 'PIX'],
      ['PLANO DE SAUDE EXEMPLO', 'OUT', 'EXPENSE', 'BOLETO'],
      ['Pagamento de fatura', 'OUT', 'INVOICE_PAYMENT', 'OTHER'],
      ['Maria Titular', 'OUT', 'EXPENSE', 'PIX'],
    ]);
    expect(lines[0]).toMatchObject({ amountCents: 6781, bankAmountCents: -6781 });
  });

  it('Pix para a titular de um cartão adicional = pagamento de fatura (D46)', () => {
    const t = statement().transactions[11]!; // "Maria Titular"
    expect(classifyAccountLine(t, owners, ['Maria Titular']).suggestedKind).toBe('INVOICE_PAYMENT');
    expect(classifyAccountLine(t, owners, ['maria titular da silva']).suggestedKind).toBe('EXPENSE');
    expect(classifyAccountLine(t, owners, ['Mãe']).suggestedKind).toBe('EXPENSE');
    // entrada da titular não é pagamento de fatura
    const inbound = { ...t, amountCents: -t.amountCents };
    expect(classifyAccountLine(inbound, owners, ['Maria Titular']).suggestedKind).toBe('INCOME');
  });

  it('contraparte: tira o prefixo do banco e os dados bancários', () => {
    expect(counterparty('Compra no débito - GP SUPERMERCADO')).toBe('GP SUPERMERCADO');
    expect(counterparty('Pagamento de boleto efetuado - PLANO DE SAUDE EXEMPLO')).toBe(
      'PLANO DE SAUDE EXEMPLO',
    );
    expect(counterparty('Algo diferente - com hífen')).toBe('Algo diferente - com hífen');
  });
});
