import { ArrowLeftRight, ChartPie, CreditCard, House, Repeat, Settings, type LucideIcon } from 'lucide-react';

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV_ITEMS = {
  home: { href: '/', label: 'Início', icon: House },
  entries: { href: '/lancamentos', label: 'Lançamentos', icon: ArrowLeftRight },
  recurring: { href: '/fixos', label: 'Fixos e recorrentes', icon: Repeat },
  cards: { href: '/cartoes', label: 'Cartões', icon: CreditCard },
  reports: { href: '/relatorios', label: 'Relatórios', icon: ChartPie },
  settings: { href: '/ajustes', label: 'Ajustes', icon: Settings },
} satisfies Record<string, NavItem>;

/** Ação principal (lançar), a 1 toque de qualquer tela. */
export const NEW_ENTRY_HREF = '/lancamentos/novo';

export function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
