import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyCardLine, paymentsOfThisInvoice, suggestCategory } from './nubank-card';
import { decodeOfx, parseOfx } from './ofx';

const statement = () =>
  parseOfx(decodeOfx(readFileSync(join(process.cwd(), 'tests/fixtures/nubank-card.ofx'))));

describe('classifyCardLine', () => {
  it('compra, parcela, pagamento e crédito', () => {
    const t = (memo: string, amountCents: number) =>
      classifyCardLine({ fitid: 'f', type: '', date: '2026-10-09', amountCents, memo });
    expect(t('Restaurante Sabor *Centro', -4510)).toMatchObject({
      kind: 'PURCHASE',
      amountCents: 4510,
      installment: null,
    });
    expect(t('Mercadolivre*Tntinfol - Parcela 7/10', -25490)).toMatchObject({
      kind: 'INSTALLMENT',
      description: 'Mercadolivre*Tntinfol',
      installment: { k: 7, n: 10 },
    });
    expect(t('Pagamento recebido', 275_311)).toMatchObject({ kind: 'PAYMENT', amountCents: 275_311 });
    expect(t('Estorno de compra', 1000)).toMatchObject({ kind: 'CREDIT' });
    expect(t('Loja - Parcela 3/2', -100)).toMatchObject({ kind: 'PURCHASE' }); // k > n: não é parcela válida
  });
});

describe('paymentsOfThisInvoice (D34)', () => {
  it('o adiantamento que fecha o saldo do arquivo é desta fatura; o resto quitou a anterior', () => {
    const s = statement();
    const lines = s.transactions.map(classifyCardLine);
    const mine = paymentsOfThisInvoice(lines, s.ledgerBalanceCents)!;
    expect([...mine]).toEqual(['00000000-0000-4000-8000-000000000008']); // R$ 50,00
  });

  it('sem saldo no arquivo ou com combinação ambígua → null (o usuário decide)', () => {
    const lines = statement().transactions.map(classifyCardLine);
    expect(paymentsOfThisInvoice(lines, null)).toBeNull();
    const twins = [
      classifyCardLine({ fitid: 'c', type: '', date: '2026-10-01', amountCents: -1000, memo: 'X' }),
      classifyCardLine({
        fitid: 'p1',
        type: '',
        date: '2026-10-01',
        amountCents: 500,
        memo: 'Pagamento recebido',
      }),
      classifyCardLine({
        fitid: 'p2',
        type: '',
        date: '2026-10-01',
        amountCents: 500,
        memo: 'Pagamento recebido',
      }),
    ];
    expect(paymentsOfThisInvoice(twins, -500)).toBeNull();
  });
});

describe('suggestCategory', () => {
  const cats = [
    { id: 'mercado', kind: 'EXPENSE', botAliases: ['mercado', 'supermercado'] },
    { id: 'transporte', kind: 'EXPENSE', botAliases: ['uber', '99'] },
    { id: 'salario', kind: 'INCOME', botAliases: ['mercado'] },
  ];
  it('pelo apelido contido na descrição (palavra inteira, o mais específico)', () => {
    expect(suggestCategory('Gp Supermercado', cats)).toBe('mercado');
    expect(suggestCategory('UBER *TRIP', cats)).toBe('transporte');
    expect(suggestCategory('Mercado*Mercadolivre', cats)).toBe('mercado');
    expect(suggestCategory('Malga *Ursushiyakidel', cats)).toBeNull();
  });
});
