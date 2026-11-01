import {
  ArrowLeftRight,
  ChartPie,
  CreditCard,
  Ellipsis,
  FileUp,
  House,
  Landmark,
  Repeat,
  Scale,
  Settings,
  Utensils,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** frase curta da tela "Mais" */
  description?: string;
  /** prefixos de rota que acendem este item (padrão: o próprio href) */
  match?: string[];
};

export const NAV_ITEMS = {
  home: { href: '/', label: 'Início', icon: House },
  entries: { href: '/lancamentos', label: 'Lançamentos', icon: ArrowLeftRight },
  reports: { href: '/relatorios', label: 'Relatórios', icon: ChartPie },
  more: { href: '/mais', label: 'Mais', icon: Ellipsis },
  cards: {
    href: '/cartoes',
    label: 'Cartões',
    icon: CreditCard,
    description: 'Faturas, compras parceladas, limite e crediários',
  },
  benefits: {
    href: '/cartoes#beneficios',
    label: 'Benefícios',
    icon: Utensils,
    description: 'Vale-alimentação e refeição',
    match: ['/beneficios'],
  },
  recurring: {
    href: '/fixos',
    label: 'Fixos e recorrentes',
    icon: Repeat,
    description: 'Contas e receitas que se repetem todo mês',
  },
  loans: {
    href: '/emprestimos',
    label: 'Empréstimos',
    icon: Landmark,
    description: 'Parcelas e quanto falta pagar',
  },
  import: {
    href: '/lancamentos/importar',
    label: 'Importar extrato',
    icon: FileUp,
    description: 'OFX ou CSV da conta, para conferir e lançar',
    match: ['/lancamentos/importar', '/importacoes'],
  },
  checkpoint: {
    href: '/conta/conferencia',
    label: 'Conferir saldo',
    icon: Scale,
    description: 'Comparar com o saldo do banco',
    match: ['/conta'],
  },
  settings: {
    href: '/ajustes',
    label: 'Ajustes',
    icon: Settings,
    description: 'Senha, tema, categorias e conta',
  },
} satisfies Record<string, NavItem>;

/** Barra inferior do celular: o botão (+) fica no meio. */
export const BOTTOM_NAV = {
  left: [NAV_ITEMS.home, NAV_ITEMS.entries],
  right: [NAV_ITEMS.reports, NAV_ITEMS.more],
} satisfies Record<string, NavItem[]>;

/** Telas do "Mais" (celular) — no desktop ficam na sidebar. */
export const MORE_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Planejamento',
    items: [NAV_ITEMS.cards, NAV_ITEMS.benefits, NAV_ITEMS.recurring, NAV_ITEMS.loans],
  },
  { title: 'Conta', items: [NAV_ITEMS.import, NAV_ITEMS.checkpoint] },
  { title: 'App', items: [NAV_ITEMS.settings] },
];

export const MORE_ITEMS: NavItem[] = MORE_GROUPS.flatMap((g) => g.items);

/** Sidebar do desktop: tudo, agrupado. */
export const SIDEBAR_GROUPS: { title?: string; items: NavItem[] }[] = [
  { items: [NAV_ITEMS.home, NAV_ITEMS.entries, NAV_ITEMS.reports] },
  ...MORE_GROUPS.filter((g) => g.title !== 'App'),
  { items: [NAV_ITEMS.settings] },
];

function routePrefixes(item: NavItem): string[] {
  return item.match ?? [item.href.split('#')[0]!];
}

function matches(pathname: string, prefix: string): boolean {
  return prefix === '/' ? pathname === '/' : pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * O item que acende para a rota: o de prefixo mais longo vence
 * (em /lancamentos/importar acende "Importar extrato", não "Lançamentos").
 */
export function activeItem(pathname: string, items: NavItem[]): NavItem | undefined {
  let best: { item: NavItem; length: number } | undefined;
  for (const item of items) {
    for (const prefix of routePrefixes(item)) {
      if (matches(pathname, prefix) && (!best || prefix.length > best.length))
        best = { item, length: prefix.length };
    }
  }
  return best?.item;
}

/** Rotas que dependem do mês escolhido: só nelas o cabeçalho mostra o seletor de mês. */
const MONTH_ROUTES = [
  /^\/$/,
  /^\/lancamentos$/,
  /^\/relatorios$/,
  /^\/resumo\/[^/]+$/,
  /^\/cartoes$/,
  /^\/cartoes\/[0-9a-f-]{36}$/i,
  /^\/beneficios\/[0-9a-f-]{36}$/i,
];

export function isMonthRoute(pathname: string): boolean {
  return MONTH_ROUTES.some((r) => r.test(pathname));
}
