import { describe, expect, it } from 'vitest';
import { parseMonthArg, resolveMonthRef } from './month-ref';

const TODAY = '2026-10-21';

describe('resolveMonthRef (o que o modelo entendeu → mês)', () => {
  it('sem referência: null = mês atual (quem chama decide)', () => {
    expect(resolveMonthRef({}, TODAY)).toBeNull();
    expect(resolveMonthRef({ offset: null, month: null, year: null }, TODAY)).toBeNull();
  });

  it('relativo: 0 atual, 1 mês que vem, -1 mês passado, atravessando o ano', () => {
    expect(resolveMonthRef({ offset: 0 }, TODAY)).toBe('2026-10-01');
    expect(resolveMonthRef({ offset: 1 }, TODAY)).toBe('2026-11-01');
    expect(resolveMonthRef({ offset: -1 }, TODAY)).toBe('2026-09-01');
    expect(resolveMonthRef({ offset: 3 }, TODAY)).toBe('2027-01-01');
    expect(resolveMonthRef({ offset: -10 }, TODAY)).toBe('2025-12-01');
  });

  it('nome do mês sem ano = esse ano (passado ou futuro); com ano = o ano', () => {
    expect(resolveMonthRef({ month: 11 }, TODAY)).toBe('2026-11-01');
    expect(resolveMonthRef({ month: 1 }, TODAY)).toBe('2026-01-01');
    expect(resolveMonthRef({ month: 1, year: 2027 }, TODAY)).toBe('2027-01-01');
  });

  it('o nome do mês vence o relativo; valores absurdos são ignorados', () => {
    expect(resolveMonthRef({ month: 5, offset: 1 }, TODAY)).toBe('2026-05-01');
    expect(resolveMonthRef({ month: 13 }, TODAY)).toBeNull();
    expect(resolveMonthRef({ month: 0 }, TODAY)).toBeNull();
    expect(resolveMonthRef({ offset: 99 }, TODAY)).toBeNull();
    expect(resolveMonthRef({ month: 3, year: 1900 }, TODAY)).toBe('2026-03-01');
  });
});

describe('parseMonthArg (argumento de comando: /pendentes novembro)', () => {
  const m = (t: string) => parseMonthArg(t, TODAY);

  it('vazio ou "atual": o mês atual (month null)', () => {
    expect(m('')).toEqual({ ok: true, month: null });
    expect(m('  ')).toEqual({ ok: true, month: null });
    expect(m('atual')).toEqual({ ok: true, month: null });
    expect(m('este mês')).toEqual({ ok: true, month: null });
  });

  it('nome do mês, completo ou abreviado, com ou sem acento', () => {
    expect(m('novembro')).toEqual({ ok: true, month: '2026-11-01' });
    expect(m('Nov')).toEqual({ ok: true, month: '2026-11-01' });
    expect(m('março')).toEqual({ ok: true, month: '2026-03-01' });
    expect(m('marco')).toEqual({ ok: true, month: '2026-03-01' });
    expect(m('dez')).toEqual({ ok: true, month: '2026-12-01' });
    expect(m('setembro de 2025')).toEqual({ ok: true, month: '2025-09-01' });
    expect(m('jan 2027')).toEqual({ ok: true, month: '2027-01-01' });
  });

  it('numérico: 11, 11/2026, 11/26 e 2026-11', () => {
    expect(m('11')).toEqual({ ok: true, month: '2026-11-01' });
    expect(m('11/2026')).toEqual({ ok: true, month: '2026-11-01' });
    expect(m('01/2027')).toEqual({ ok: true, month: '2027-01-01' });
    expect(m('11/26')).toEqual({ ok: true, month: '2026-11-01' });
    expect(m('2026-11')).toEqual({ ok: true, month: '2026-11-01' });
  });

  it('relativo: próximo, mês que vem, passado, anterior', () => {
    expect(m('próximo')).toEqual({ ok: true, month: '2026-11-01' });
    expect(m('mês que vem')).toEqual({ ok: true, month: '2026-11-01' });
    expect(m('passado')).toEqual({ ok: true, month: '2026-09-01' });
    expect(m('mês anterior')).toEqual({ ok: true, month: '2026-09-01' });
  });

  it('o que não é mês é recusado (em vez de chutar)', () => {
    expect(m('banana')).toEqual({ ok: false });
    expect(m('13')).toEqual({ ok: false });
    expect(m('0')).toEqual({ ok: false });
    expect(m('99/2026')).toEqual({ ok: false });
  });
});
