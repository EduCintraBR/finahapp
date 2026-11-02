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

export type CategoryNode = {
  id: string;
  kind: CategoryKind;
  parentId: string | null;
  name: string;
  archived: boolean;
};

/**
 * Subcategorias (D74): no máximo 2 níveis (categoria › subcategoria), a subcategoria tem o tipo da mãe e
 * a mãe tem que estar ativa. `parent` nulo = categoria de topo (sempre permitido).
 */
export function validateParent(
  child: { id: string; kind: CategoryKind; name: string; hasChildren: boolean },
  parent: CategoryNode | null,
): { ok: true } | { ok: false; error: string } {
  if (parent === null) return { ok: true };
  if (parent.id === child.id) return { ok: false, error: 'Uma categoria não pode ficar dentro dela mesma.' };
  if (isProtectedCategory(child.kind, child.name))
    return {
      ok: false,
      error: `"${child.name}" é usada pelo bot e pelas importações e não pode virar subcategoria.`,
    };
  if (parent.parentId !== null)
    return { ok: false, error: 'Só há 2 níveis: categoria e subcategoria. Escolha uma categoria de topo.' };
  if (parent.kind !== child.kind)
    return {
      ok: false,
      error: 'A subcategoria precisa ser do mesmo tipo (despesa ou receita) da categoria.',
    };
  if (parent.archived) return { ok: false, error: `A categoria "${parent.name}" está arquivada.` };
  if (child.hasChildren)
    return {
      ok: false,
      error: `"${child.name}" tem subcategorias: mova-as para fora antes de colocá-la dentro de outra categoria.`,
    };
  return { ok: true };
}

/** Nome repetido entre irmãs (mesmo tipo e mesma mãe), sem diferenciar acento nem caixa. */
export function findNameClash<T extends { id: string; name: string }>(
  name: string,
  siblings: readonly T[],
  selfId: string | null,
): T | undefined {
  return siblings.find((s) => s.id !== selfId && normalizeAlias(s.name) === normalizeAlias(name));
}

/** "Mercado › Hortifruti" para subcategoria; só o nome para categoria de topo. */
export const categoryLabel = (name: string, parentName: string | null): string =>
  parentName ? `${parentName} › ${name}` : name;

/**
 * Por que a categoria de um lançamento não pode ser trocada por aqui (null = pode). Empréstimo tem categoria própria
 * do sistema e o crédito de benefício também; pagamentos de fatura e antecipações não são gasto (invariante 6).
 */
export function categoryChangeBlock(t: {
  kind: string;
  loanId: string | null;
  benefitWalletId: string | null;
}): string | null {
  if (t.kind !== 'EXPENSE' && t.kind !== 'INCOME')
    return 'Este tipo de lançamento não tem categoria para trocar.';
  if (t.loanId !== null)
    return 'A categoria do empréstimo é do sistema e não muda: parcelas e valor recebido são tratados na tela do empréstimo.';
  if (t.kind === 'INCOME' && t.benefitWalletId !== null)
    return 'O crédito do benefício tem categoria própria e não muda.';
  return null;
}
