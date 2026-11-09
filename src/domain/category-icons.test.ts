import { describe, expect, it } from 'vitest';
import { seedCategories } from '@/db/seed-data';
import { CATEGORY_ICONS, categoryIconLabel, isCategoryIcon } from './category-icons';

describe('catálogo de ícones das categorias', () => {
  it('tem vários ícones, sem nome nem rótulo repetido', () => {
    const names = CATEGORY_ICONS.map((i) => i.name);
    const labels = CATEGORY_ICONS.map((i) => i.label);
    expect(names.length).toBeGreaterThanOrEqual(60);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('nomes no formato do Lucide e cabendo na coluna (varchar 40)', () => {
    for (const { name } of CATEGORY_ICONS) {
      expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(name.length).toBeLessThanOrEqual(40);
    }
  });

  it('inclui todos os ícones das categorias do seed', () => {
    const seeded = [...seedCategories.EXPENSE, ...seedCategories.INCOME].map((c) => c.icon);
    for (const icon of seeded) expect(isCategoryIcon(icon), icon).toBe(true);
  });

  it('isCategoryIcon recusa o que não está no catálogo; o rótulo sai em pt-BR', () => {
    expect(isCategoryIcon('house')).toBe(true);
    expect(isCategoryIcon('House')).toBe(false);
    expect(isCategoryIcon('')).toBe(false);
    expect(isCategoryIcon('skull')).toBe(false);
    expect(categoryIconLabel('shopping-cart')).toBe('Mercado');
    expect(categoryIconLabel('nao-existe')).toBeNull();
    expect(categoryIconLabel(null)).toBeNull();
  });
});
