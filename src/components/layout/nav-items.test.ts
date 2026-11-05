import { describe, expect, it } from 'vitest';
import { withMonth } from './month-link';
import {
  BOTTOM_NAV,
  CASA_BOTTOM_NAV,
  CASA_ITEMS,
  CASA_MORE_ITEMS,
  MORE_ITEMS,
  NAV_ITEMS,
  activeItem,
  areaOf,
  isMonthRoute,
} from './nav-items';

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
    expect(activeItem('/categorias', bottom)).toBe(NAV_ITEMS.categories);
    expect(activeItem(`/categorias/${id}`, bottom)).toBe(NAV_ITEMS.categories);
    expect(activeItem('/categorias/subcategorias/nova', bottom)).toBe(NAV_ITEMS.categories);
    expect(activeItem('/mais', bottom)).toBe(NAV_ITEMS.more);
    expect(activeItem(`/orcamentos/${id}`, bottom)).toBe(NAV_ITEMS.budgets);
  });

  it('não confunde prefixo de palavra', () => {
    expect(activeItem('/cartoesx', bottom)).toBeUndefined();
  });
});

describe('área Casa (D81)', () => {
  const casa = [...CASA_BOTTOM_NAV.left, ...CASA_BOTTOM_NAV.right, ...CASA_MORE_ITEMS];

  it('tudo em /casa é da Casa; o resto, inclusive Ajustes, das Finanças', () => {
    expect(areaOf('/casa')).toBe('casa');
    expect(areaOf(`/casa/produtos/${id}`)).toBe('casa');
    expect(areaOf('/')).toBe('financas');
    expect(areaOf('/ajustes')).toBe('financas');
    expect(areaOf('/casas')).toBe('financas');
  });

  it('produto e entrada acendem o Estoque; cadastros acendem o próprio item', () => {
    expect(activeItem('/casa', casa)).toBe(CASA_ITEMS.home);
    expect(activeItem(`/casa/produtos/${id}`, casa)).toBe(CASA_ITEMS.stock);
    expect(activeItem('/casa/entrada', casa)).toBe(CASA_ITEMS.stock);
    expect(activeItem('/casa/buscar', casa)).toBe(CASA_ITEMS.search);
    expect(activeItem('/casa/locais', casa)).toBe(CASA_ITEMS.locations);
  });

  it('o Mais das Finanças leva à Casa, e o da Casa volta às Finanças', () => {
    expect(MORE_ITEMS).toContain(NAV_ITEMS.casa);
    expect(CASA_MORE_ITEMS).toContain(CASA_ITEMS.finances);
  });

  it('a Casa não mostra o seletor de mês', () => {
    for (const p of ['/casa', '/casa/estoque', `/casa/produtos/${id}`])
      expect(isMonthRoute(p), p).toBe(false);
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
      '/orcamentos',
      `/orcamentos/${id}`,
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
