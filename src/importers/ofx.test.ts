import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatDecimalBR } from '@/domain/money';
import { OfxError, decodeOfx, parseOfx, parseOfxAmount, parseOfxDate } from './ofx';

const fixture = () => decodeOfx(readFileSync(join(process.cwd(), 'tests/fixtures/nubank-card.ofx')));

describe('parseOfx (fatura Nubank, SGML 1.02)', () => {
  it('lê cabeçalho, período, saldo e todas as transações', () => {
    const s = parseOfx(fixture());
    expect(s).toMatchObject({
      account: 'CREDIT_CARD',
      currency: 'BRL',
      periodStart: '2026-10-09',
      periodEnd: '2026-11-09',
      ledgerBalanceCents: -81_861,
    });
    expect(s.transactions).toHaveLength(10);
    expect(s.transactions[0]).toEqual({
      fitid: '00000000-0000-4000-8000-000000000001',
      type: 'DEBIT',
      date: '2026-10-17',
      amountCents: -4510,
      memo: 'Restaurante Sabor *Centro',
    });
    expect(s.transactions.find((t) => t.type === 'CREDIT')).toMatchObject({
      amountCents: 100_000,
      memo: 'Pagamento recebido',
    });
  });

  it('respeita o CHARSET 1252 (acentos)', () => {
    expect(parseOfx(fixture()).transactions.map((t) => t.memo)).toContain('Café Exemplo');
  });

  it('OFX 2.x (XML com fechamento de tags) e conta corrente', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="211"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF><BANKACCTFROM><ACCTID>123</ACCTID></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001</DTSTART><DTEND>20261031</DTEND>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261005120000</DTPOSTED><TRNAMT>-10,50</TRNAMT><FITID>A1</FITID><NAME>PIX &amp; CIA</NAME></STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1000.00</BALAMT><DTASOF>20261031</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const s = parseOfx(xml);
    expect(s).toMatchObject({ account: 'BANK', accountId: '123', ledgerBalanceCents: 100_000 });
    expect(s.transactions).toEqual([
      { fitid: 'A1', type: 'DEBIT', date: '2026-10-05', amountCents: -1050, memo: 'PIX & CIA' },
    ]);
  });

  it.each([
    ['não é OFX', 'qualquer coisa', 'não parece um OFX'],
    ['sem transações', '<OFX><BANKTRANLIST></BANKTRANLIST></OFX>', 'Nenhuma transação'],
    [
      'FITID repetido',
      '<OFX><STMTTRN><TRNAMT>-1<FITID>X<DTPOSTED>20261001</STMTTRN><STMTTRN><TRNAMT>-2<FITID>X<DTPOSTED>20261001</STMTTRN></OFX>',
      'repetidas',
    ],
  ])('recusa: %s', (_, text, msg) => {
    expect(() => parseOfx(text)).toThrow(OfxError);
    expect(() => parseOfx(text)).toThrow(msg);
  });
});

describe('valores e datas do OFX', () => {
  it.each([
    ['-1351.87', -135_187],
    ['2753.11', 275_311],
    ['-3.9', -390],
    ['100', 10_000],
    ['+5,05', 505],
    ['-0.00', 0],
  ])('%s → %i', (raw, cents) => expect(parseOfxAmount(raw)).toBe(cents));

  it.each(['1.234,56', '-12.345', 'abc', '1e3'])('recusa %s', (raw) =>
    expect(() => parseOfxAmount(raw)).toThrow(OfxError),
  );

  it('property: centavos → texto do banco → centavos', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), (c) => {
        expect(parseOfxAmount(formatDecimalBR(c).replace(/\./g, '').replace(',', '.'))).toBe(c);
      }),
    );
  });

  it('data local do banco, sem conversão de fuso', () => {
    expect(parseOfxDate('20261017000000[-3:BRT]')).toBe('2026-10-17');
    expect(parseOfxDate('20261231235959[0:GMT]')).toBe('2026-12-31');
    expect(() => parseOfxDate('20260230')).toThrow(OfxError);
  });
});
