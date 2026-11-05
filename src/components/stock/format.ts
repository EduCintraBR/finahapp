import { formatDateBR } from '@/domain/dates';
import { formatAmount, formatPackages, type Measure } from '@/domain/stock/measure';
import type { MovementKind } from '@/domain/stock/quantity';

/** O que a lista mostra de um produto: o total na medida dele e, abaixo, as embalagens. */
export function quantityText(p: {
  measure: Measure;
  packages: number;
  total: number;
  packageNames: string[];
}): { main: string; packages: string | null } {
  if (p.packages === 0) return { main: 'Sem estoque', packages: null };
  const packages =
    p.packageNames.length === 1
      ? formatPackages(p.packages, p.packageNames[0]!)
      : `${p.packages} ${p.packages === 1 ? 'embalagem' : 'embalagens'}`;
  // em unidades sem conteúdo por embalagem, total = embalagens: mostra só uma vez ("3 frascos")
  if (p.measure === 'UNIT' && p.total === p.packages) return { main: packages, packages: null };
  return { main: formatAmount(p.measure, p.total), packages };
}

/** "2 pacotes de 5 kg" / "3 frascos". */
export function lotContentText(
  lot: { quantity: number; packageName: string; contentPerPackage: number | null },
  measure: Measure,
) {
  const packages = formatPackages(lot.quantity, lot.packageName);
  return lot.contentPerPackage ? `${packages} de ${formatAmount(measure, lot.contentPerPackage)}` : packages;
}

export const MOVEMENT_LABEL: Record<MovementKind, string> = {
  IN: 'Entrada',
  USE: 'Usei',
  DISCARD: 'Descartei',
  ADJUST: 'Contei',
  REPACK_OUT: 'Saiu para envase',
  REPACK_IN: 'Envasado',
};

export function signedPackages(quantity: number): string {
  return quantity > 0 ? `+${quantity}` : `−${Math.abs(quantity)}`;
}

export const dateBR = (d: string | null) => (d ? formatDateBR(d) : null);
