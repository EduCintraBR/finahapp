/**
 * Regras puras das categorias (D49): nome, apelidos do bot e categorias protegidas.
 * Sem banco e sem Next: o serviço em src/server/categories.ts só orquestra.
 */

export type CategoryKind = 'EXPENSE' | 'INCOME';

/** O bot e as importações caem nestas quando não reconhecem a categoria: não podem sumir nem mudar de nome. */
const PROTECTED: readonly { kind: CategoryKind; name: string }[] = [
  { kind: 'EXPENSE', name: 'A classificar' },
  { kind: 'INCOME', name: 'Outras receitas' },
];

export const isProtectedCategory = (kind: CategoryKind, name: string): boolean =>
  PROTECTED.some((p) => p.kind === kind && p.name === name);

/** Mesma normalização do reconhecimento por apelido (importação e bot): sem acento, minúsculas, símbolos viram espaço. */
export function normalizeAlias(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const ALIAS_MIN = 2;
export const ALIAS_MAX = 40;

/** Texto livre ("luz, energia; água") → apelidos normalizados, sem repetir. Lança Error em pt-BR se algum for inválido. */
export function parseAliases(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[,;\n]+/)) {
    const alias = normalizeAlias(raw);
    if (alias === '') continue;
    if (alias.length < ALIAS_MIN)
      throw new Error(`O apelido "${raw.trim()}" precisa ter pelo menos ${ALIAS_MIN} letras.`);
    if (alias.length > ALIAS_MAX)
      throw new Error(`O apelido "${raw.trim().slice(0, 12)}…" pode ter no máximo ${ALIAS_MAX} caracteres.`);
    if (!out.includes(alias)) out.push(alias);
  }
  return out;
}

/** Apelidos que já pertencem a outra categoria (o reconhecimento ficaria ambíguo). */
export function findAliasConflicts(
  aliases: readonly string[],
  others: readonly { name: string; botAliases: readonly string[] }[],
): { alias: string; categoryName: string }[] {
  const conflicts: { alias: string; categoryName: string }[] = [];
  for (const raw of aliases) {
    const alias = normalizeAlias(raw);
    const owner = others.find((o) => o.botAliases.some((a) => normalizeAlias(a) === alias));
    if (owner) conflicts.push({ alias, categoryName: owner.name });
  }
  return conflicts;
}

export const NAME_MIN = 2;
export const NAME_MAX = 60;

export function validateCategoryName(
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.replace(/\s+/g, ' ').trim();
  if (value.length < NAME_MIN)
    return { ok: false, error: `Informe o nome da categoria (mínimo ${NAME_MIN} letras).` };
  if (value.length > NAME_MAX)
    return { ok: false, error: `O nome pode ter no máximo ${NAME_MAX} caracteres.` };
  return { ok: true, value };
}
