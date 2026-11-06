/**
 * Reposição da Casa (D86): "Acabando" (abaixo do estoque mínimo) e a lista de compras (quanto falta para a meta).
 * Tudo derivado da quantidade atual, nunca armazenado; inteiros em g/ml/un, como o resto do estoque.
 */
import type { Measure } from './measure';
import { MAX_PACKAGES } from './quantity';

/** Acabando: abaixo do mínimo (no mínimo ainda não; sem mínimo, nunca). */
export function isLow(total: number, min: number | null): boolean {
  return min !== null && total < min;
}

export type RestockNeed = {
  /** até onde repor: a meta; sem meta, o mínimo */
  reference: number;
  /** quanto falta, na medida do produto */
  missing: number;
  /** embalagens inteiras para cobrir a falta, pelo conteúdo de costume (null = não dá para sugerir) */
  packages: number | null;
  belowMin: boolean;
};

/**
 * O que falta repor, ou null se o produto não precisa de nada (já na meta, ou sem meta nem mínimo). A sugestão de
 * embalagens arredonda para cima; por unidade, sem conteúdo de costume, cada embalagem é 1 unidade.
 */
export function restockNeed(input: {
  total: number;
  min: number | null;
  target: number | null;
  measure: Measure;
  defaultContent: number | null;
}): RestockNeed | null {
  const reference = input.target ?? input.min;
  if (reference === null || input.total >= reference) return null;
  const missing = reference - input.total;
  const content = input.defaultContent ?? (input.measure === 'UNIT' ? 1 : null);
  return {
    reference,
    missing,
    packages: content && content > 0 ? Math.min(Math.ceil(missing / content), MAX_PACKAGES) : null,
    belowMin: isLow(input.total, input.min),
  };
}
