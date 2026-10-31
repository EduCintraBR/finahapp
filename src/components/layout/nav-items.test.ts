import { describe, expect, it } from 'vitest';
import { withMonth } from './month-link';
import { BOTTOM_NAV, MORE_ITEMS, NAV_ITEMS, activeItem, isMonthRoute } from './nav-items';

const bottom = [...BOTTOM_NAV.left, ...BOTTOM_NAV.right, ...MORE_ITEMS];
const id = '0b7c1f6e-3a1d-4c4e-9a52-0d0c6c2b7a11';

describe('activeItem', () => {
  it('Início só na raiz', () => {
    expect(activeItem('/', bottom)).toBe(NAV_ITEMS.home);
    expect(activeItem('/resumo/saiu', bottom)).toBeUndefined();
  });

  it('o prefixo mais longo vence: importar não acende Lançamentos', () => {
    expect(activeItem('/lancamentos', bottom)).toBe(NAV_ITEMS.entries);
    expect(activeItem(`/lancamentos/${id}`, bottom)).toBe(NAV_ITEMS.entries);
    expect(activeItem('/lancamentos/importar', bottom)).toBe(NAV_ITEMS.import);
    expect(activeItem(`/importacoes/${id}`, bottom)).toBe(NAV_ITEMS.import);
  });

  it('telas do "Mais" acendem o próprio item', () => {
    expect(activeItem(`/cartoes/faturas/${id}`, bottom)).toBe(NAV_ITEMS.cards);
    expect(activeItem(`/beneficios/${id}`, bottom)).toBe(NAV_ITEMS.benefits);
    expect(activeItem('/conta/conferencia', bottom)).toBe(NAV_ITEMS.checkpoint);
    expect(activeItem('/ajustes/categorias', bottom)).toBe(NAV_ITEMS.settings);
    expect(activeItem('/mais', bottom)).toBe(NAV_ITEMS.more);
  });

  it('não confunde prefixo de palavra', () => {
    expect(activeItem('/cartoesx', bottom)).toBeUndefined();
  });
});

describe('isMonthRoute', () => {
  it('telas que dependem do mês', () => {
    for (const p of [
      '/',
      '/lancamentos',
      '/relatorios',
      '/resumo/saiu',
      '/cartoes',
      `/cartoes/${id}`,
      `/beneficios/${id}`,
    ])
      expect(isMonthRoute(p), p).toBe(true);
  });

  it('formulários, detalhes e configurações não mostram o seletor', () => {
    for (const p of [
      '/lancamentos/novo',
      `/lancamentos/${id}`,
      '/lancamentos/importar',
      '/relatorios/projecao',
      '/cartoes/novo',
      `/cartoes/faturas/${id}`,
      `/cartoes/${id}/importar`,
      '/beneficios/novo',
      '/fixos',
      '/emprestimos',
      '/ajustes',
      '/mais',
    ])
      expect(isMonthRoute(p), p).toBe(false);
  });
});

describe('withMonth', () => {
  const params = (mes?: string) => new URLSearchParams(mes ? { mes } : {});

  it('mantém o mês e a âncora', () => {
    expect(withMonth('/cartoes#beneficios', params('2026-09'))).toBe('/cartoes?mes=2026-09#beneficios');
    expect(withMonth('/cartoes', params('2026-09'))).toBe('/cartoes?mes=2026-09');
  });

  it('sem mês (ou mês inválido) não mexe no link', () => {
    expect(withMonth('/cartoes#beneficios', params())).toBe('/cartoes#beneficios');
    expect(withMonth('/cartoes', params('xx'))).toBe('/cartoes');
  });
});
