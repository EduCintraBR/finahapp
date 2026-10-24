import { describe, expect, it } from 'vitest';
import { confirmPaymentInput, entryInput, invoicePaymentInput, loanPaymentInput } from './schemas';

const id = '0b9a7f0e-6b0e-4b8e-9f43-1a2b3c4d5e6f';
const base = {
  kind: 'EXPENSE',
  amount: '123,45',
  description: 'Cemig',
  categoryId: id,
  paymentMethod: 'BOLETO',
  date: '2026-10-17',
};

describe('entryInput: chave "Já paguei" e aporte (D69)', () => {
  it('"true"/"false" do formulário; ausente fica indefinido (bot e importação seguem pagos)', () => {
    expect(entryInput.parse({ ...base, paid: 'true' }).paid).toBe(true);
    expect(entryInput.parse({ ...base, paid: 'false' }).paid).toBe(false);
    expect(entryInput.parse(base).paid).toBeUndefined();
    expect(entryInput.parse({ ...base, paid: '' }).paid).toBeUndefined();
  });

  it('o formulário manda o hidden "false" e depois o checkbox "true": vale o último', () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(base)) fd.append(k, v);
    fd.append('paid', 'false');
    fd.append('paid', 'true');
    expect(entryInput.parse(Object.fromEntries(fd)).paid).toBe(true);
  });

  it('aporte: valor em reais vira centavos; vazio é ausente; observação é aparada', () => {
    const r = entryInput.parse({ ...base, fundingAmount: '1.234,56', fundingNote: '  Poupança  ' });
    expect(r.fundingAmount).toBe(123_456);
    expect(r.fundingNote).toBe('Poupança');
    const empty = entryInput.parse({ ...base, fundingAmount: '', fundingNote: '' });
    expect(empty.fundingAmount).toBeUndefined();
    expect(empty.fundingNote).toBeUndefined();
    expect(entryInput.safeParse({ ...base, fundingAmount: '0,00' }).success).toBe(false);
  });
});

describe('os outros pagamentos aceitam o aporte e a carteira', () => {
  it('baixa: carteira opcional (vazio = conta) e aporte', () => {
    const none = confirmPaymentInput.parse({ date: '2026-10-17', amount: '10,00', walletId: '' });
    expect(none.walletId).toBeNull();
    const withWallet = confirmPaymentInput.parse({ date: '2026-10-17', amount: '10,00', walletId: id });
    expect(withWallet.walletId).toBe(id);
    expect(confirmPaymentInput.parse({ date: '2026-10-17', amount: '10,00' }).walletId).toBeUndefined();
    expect(
      confirmPaymentInput.parse({
        date: '2026-10-17',
        amount: '10,00',
        fundingAmount: '5,00',
        fundingNote: 'Pix',
      }).fundingAmount,
    ).toBe(500);
  });

  it('fatura e parcelas de empréstimo', () => {
    const inv = invoicePaymentInput.parse({
      amount: '900,00',
      date: '2026-10-17',
      paymentMethod: 'PIX',
      fundingAmount: '400,00',
      fundingNote: 'Venda',
    });
    expect(inv.fundingAmount).toBe(40_000);
    const loan = loanPaymentInput.parse({
      installmentIds: [id],
      paid: '100,00',
      date: '2026-10-17',
      fundingAmount: '10,00',
      fundingNote: 'Bônus',
    });
    expect(loan.fundingNote).toBe('Bônus');
  });
});
