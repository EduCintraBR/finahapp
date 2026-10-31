import type { Slice } from './charts';

/** Cores das fatias: a paleta validada (slots 1 a 5) e um neutro para "Outras". */
export const SLICE_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
];
export const OTHER_COLOR = 'var(--series-other)';
export const TOP_SLICES = 5;

/** Cor da categoria na posição `i` do ranking: as 5 maiores com cor própria, o resto no neutro de "Outras". */
export const sliceColor = (i: number) => SLICE_COLORS[i] ?? OTHER_COLOR;

/** As 5 maiores categorias (só valores positivos, já ordenadas) e o resto somado em "Outras". */
export function buildSlices(ranked: { key: string; name: string; cents: number }[]): Slice[] {
  const positive = ranked.filter((r) => r.cents > 0);
  const slices: Slice[] = positive
    .slice(0, TOP_SLICES)
    .map((r, i) => ({ key: r.key, name: r.name, cents: r.cents, color: sliceColor(i) }));
  const rest = positive.slice(TOP_SLICES).reduce((sum, r) => sum + r.cents, 0);
  if (rest > 0) slices.push({ key: 'outras', name: 'Outras', cents: rest, color: OTHER_COLOR });
  return slices;
}
