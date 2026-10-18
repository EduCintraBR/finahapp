import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyCardLine } from './nubank-card';
import { parseNubankAccountCsv, parseNubankCardCsv } from './nubank-csv';
import { parseCsv } from './csv';
import { readStatement } from './statement';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('parseCsv', () => {
  it('vírgula ou ponto e vírgula, aspas, aspas duplas escapadas, BOM e CRLF', () => {
    expect(parseCsv('﻿a,b,c\r\n1,"x, y",3\r\n"say ""hi""",,\r\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', '3'],
      ['say "hi"', '', ''],
    ]);
    expect(parseCsv('Data;Valor\n01/10/2026;-1,50\n')).toEqual([
      ['Data', 'Valor'],
      ['01/10/2026', '-1,50'],
    ]);
  });

  it('ignora linhas em branco', () => {
    expect(parseCsv('a,b\n\n1,2\n  \n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('CSV da conta (Nubank)', () => {
  const csv = [
    'Data,Valor,Identificador,Descrição',
    '01/10/2026,-67.81,10000000-0000-4000-8000-000000000001,Transferência enviada pelo Pix - RECEITA FEDERAL',
    '15/10/2026,7000.00,10000000-0000-4000-8000-000000000008,Transferência Recebida - EMPRESA TESTE',
    '17/10/2026,"-1.234,56",,Pagamento de boleto efetuado - PLANO DE SAUDE EXEMPLO',
  ].join('\n');

  it('lê data dd/mm/aaaa, valor com sinal, identificador como FITID; não inventa período nem saldo', () => {
    const s = parseNubankAccountCsv(csv);
    expect(s).toMatchObject({
      account: 'BANK',
      periodStart: null,
      periodEnd: null,
      ledgerBalanceCents: null,
    });
    expect(s.transactions).toHaveLength(3);
    expect(s.transactions[0]).toMatchObject({
      fitid: '10000000-0000-4000-8000-000000000001',
      date: '2026-10-01',
      amountCents: -6781,
      type: 'DEBIT',
    });
    expect(s.transactions[1]).toMatchObject({ amountCents: 700_000, type: 'CREDIT' });
    // sem identificador: um FITID estável gerado da linha
    expect(s.transactions[2]!.fitid).toMatch(/^csv-[0-9a-f]{20}$/);
    expect(s.transactions[2]!.amountCents).toBe(-123_456);
    expect(parseNubankAccountCsv(csv).transactions[2]!.fitid).toBe(s.transactions[2]!.fitid);
  });

  it('reconhece os cabeçalhos pelo nome, em qualquer ordem e com acento', () => {
    const s = parseNubankAccountCsv('Descrição;Valor;Data\nCafé;-3,50;2026-10-02\n');
    expect(s.transactions[0]).toMatchObject({ memo: 'Café', amountCents: -350, date: '2026-10-02' });
  });

  it('erros claros em pt-BR com o número da linha', () => {
    expect(() => parseNubankAccountCsv('Foo,Bar\n1,2')).toThrow(/não encontrei as colunas.*Data.*Valor/i);
    expect(() => parseNubankAccountCsv('Data,Valor,Descrição\n31/02/2026,1,x')).toThrow(/linha 2.*data/i);
    expect(() => parseNubankAccountCsv('Data,Valor,Descrição\n01/10/2026,abc,x')).toThrow(/linha 2.*valor/i);
    expect(() => parseNubankAccountCsv('Data,Valor,Descrição\n')).toThrow(/nenhuma linha/i);
  });
});

describe('CSV da fatura do cartão (Nubank)', () => {
  const csv = [
    'date,category,title,amount',
    '2026-10-10,saúde,Farmacia Exemplo - Parcela 1/2,87.38',
    '2026-10-12,restaurante,iFood Delivery,36.13',
    '2026-10-12,restaurante,iFood Delivery,36.13',
    '2026-10-15,,Pagamento recebido,-113.59',
    '2026-10-16,,Estorno de compra,-10.00',
  ].join('\n');

  it('compra positiva vira saída; pagamento e estorno (negativos) viram entrada, como no OFX', () => {
    const s = parseNubankCardCsv(csv);
    expect(s).toMatchObject({ account: 'CREDIT_CARD', periodEnd: null, ledgerBalanceCents: null });
    expect(s.transactions.map((t) => t.amountCents)).toEqual([-8738, -3613, -3613, 11_359, 1_000]);
    const kinds = s.transactions.map((t) => classifyCardLine(t).kind);
    expect(kinds).toEqual(['INSTALLMENT', 'PURCHASE', 'PURCHASE', 'PAYMENT', 'CREDIT']);
    expect(classifyCardLine(s.transactions[0]!).installment).toEqual({ k: 1, n: 2 });
  });

  it('duas compras idênticas no mesmo dia têm FITIDs diferentes, e reimportar gera os mesmos', () => {
    const a = parseNubankCardCsv(csv).transactions;
    expect(a[1]!.fitid).not.toBe(a[2]!.fitid);
    expect(parseNubankCardCsv(csv).transactions.map((t) => t.fitid)).toEqual(a.map((t) => t.fitid));
  });

  it('aceita a versão sem categoria (date,title,amount)', () => {
    const s = parseNubankCardCsv('date,title,amount\n2026-10-10,Loja,10.00\n');
    expect(s.transactions[0]).toMatchObject({ memo: 'Loja', amountCents: -1000 });
  });
});

describe('readStatement: OFX ou CSV, pelo conteúdo', () => {
  it('detecta OFX mesmo com extensão estranha e CSV pelo resto', () => {
    const ofx = readFileSync(join(process.cwd(), 'tests/fixtures/nubank-account.ofx'));
    expect(readStatement(ofx, 'BANK')).toMatchObject({
      format: 'OFX',
      account: 'BANK',
      ledgerBalanceCents: 556_594,
    });
    const csv = readStatement(bytes('Data,Valor,Descrição\n01/10/2026,-1.00,x\n'), 'BANK');
    expect(csv.format).toBe('CSV');
    expect(csv.account).toBe('BANK');
    expect(readStatement(bytes('date,title,amount\n2026-10-10,Loja,1.00\n'), 'CREDIT_CARD').account).toBe(
      'CREDIT_CARD',
    );
  });

  it('CSV do tipo errado é recusado, com o caminho certo (senão a fatura sairia com os sinais invertidos)', () => {
    expect(() =>
      readStatement(bytes('Data,Valor,Identificador,Descrição\n01/10/2026,-1.00,abc,x\n'), 'CREDIT_CARD'),
    ).toThrow(/parece ser do extrato da conta/i);
    expect(() => readStatement(bytes('date,title,amount\n2026-10-10,Loja,1.00\n'), 'BANK')).toThrow(
      /parece ser de uma fatura de cartão/i,
    );
  });

  it('decodifica Windows-1252 quando o arquivo não é UTF-8', () => {
    const latin1 = new Uint8Array([
      ...bytes('Data,Valor,Descri'),
      0xe7,
      0xe3,
      0x6f,
      ...bytes('\n01/10/2026,-1.00,Caf'),
      0xe9,
      0x0a,
    ]);
    expect(readStatement(latin1, 'BANK').transactions[0]!.memo).toBe('Café');
  });
});
