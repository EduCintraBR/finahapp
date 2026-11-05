/**
 * Catálogo da Casa: código do lote (D87), busca sem acento e as categorias sugeridas (D81).
 */

/** Prefixo do código do lote: 2 a 4 letras ou números, maiúsculos (ex.: ARR). */
export const PREFIX_PATTERN = /^[A-Z0-9]{2,4}$/;

/** Sem acento, minúsculo e com espaços simples: base da busca e do prefixo. */
export function normalizeText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Todos os termos da busca aparecem em algum dos campos (sem acento e sem diferença de maiúsculas). */
export function matchesSearch(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const terms = normalizeText(query).split(' ').filter(Boolean);
  if (terms.length === 0) return false;
  const haystack = normalizeText(fields.filter(Boolean).join(' '));
  return terms.every((t) => haystack.includes(t));
}

/** "ARR" + 3 → "ARR-03". */
export function lotCode(prefix: string, number: number): string {
  return `${prefix}-${String(number).padStart(2, '0')}`;
}

/**
 * Prefixo sugerido a partir do nome, livre entre os já usados: as 3 primeiras letras ("Arroz" → ARR); depois a 1ª
 * letra de cada palavra ("Feijão preto" → FP… completado); depois a 1ª letra com as consoantes seguintes; por fim,
 * 2 letras + um número.
 */
export function suggestPrefix(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.toUpperCase()));
  const clean = normalizeText(name)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '');
  const letters = clean.replace(/ /g, '');
  const base = (letters + 'XXX').slice(0, 3);
  const words = clean.split(' ').filter(Boolean);
  const candidates = [
    base,
    (words.map((w) => w[0]).join('') + letters.slice(1)).slice(0, 3),
    (letters[0] ?? 'X') +
      letters
        .slice(1)
        .replace(/[AEIOU]/g, '')
        .replace(/(.)\1+/g, '$1')
        .slice(0, 2),
  ].filter((c) => PREFIX_PATTERN.test(c) && c.length === 3);
  for (const c of candidates) if (!used.has(c)) return c;
  const two = base.slice(0, 2);
  for (let n = 1; n <= 99; n++) {
    const c = `${two}${n}`;
    if (!used.has(c)) return c;
  }
  // 99 produtos com o mesmo começo: improvável numa casa; ainda assim, nunca devolve um prefixo usado
  for (let n = 100; ; n++) {
    const c = `${two[0]}${n}`.slice(0, 4);
    if (!used.has(c)) return c;
  }
}

export type SuggestedCategory = { name: string; icon: string; children: string[] };

/** Criadas pelo botão "Usar categorias sugeridas" quando a lista está vazia (nunca pelo seed). */
export const SUGGESTED_CATEGORIES: SuggestedCategory[] = [
  {
    name: 'Alimentos',
    icon: 'wheat',
    children: ['Grãos', 'Massas', 'Enlatados', 'Café da manhã', 'Temperos'],
  },
  { name: 'Água', icon: 'droplets', children: [] },
  { name: 'Limpeza', icon: 'spray-can', children: [] },
  { name: 'Lavanderia', icon: 'shirt', children: [] },
  { name: 'Higiene', icon: 'bath', children: [] },
  { name: 'Remédios', icon: 'pill', children: [] },
];
