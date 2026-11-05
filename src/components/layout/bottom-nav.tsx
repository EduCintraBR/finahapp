'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { PackagePlus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BOTTOM_NAV,
  CASA_BOTTOM_NAV,
  CASA_ITEMS,
  CASA_MORE_ITEMS,
  MORE_ITEMS,
  NAV_ITEMS,
  activeItem,
  areaOf,
  type NavItem,
} from './nav-items';
import { withMonth } from './month-link';
import { NewEntrySheet } from './new-entry-sheet';

const ALL = [...BOTTOM_NAV.left, ...BOTTOM_NAV.right, ...MORE_ITEMS];
const CASA_ALL = [...CASA_BOTTOM_NAV.left, ...CASA_BOTTOM_NAV.right, ...CASA_MORE_ITEMS];

const CENTER_BUTTON =
  'flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md active:scale-95';

/**
 * Navegação inferior do celular (< md). Nas Finanças, o botão central abre o painel de "lançar"; na Casa (D81),
 * leva à entrada de estoque.
 */
export function BottomNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const casa = areaOf(pathname) === 'casa';
  const nav = casa ? CASA_BOTTOM_NAV : BOTTOM_NAV;
  const current = activeItem(pathname, casa ? CASA_ALL : ALL);
  // as telas do "Mais" (Cartões, Fixos, Ajustes…) acendem o "Mais"
  const more = casa ? CASA_MORE_ITEMS : MORE_ITEMS;
  const lit = current && more.includes(current) ? (casa ? CASA_ITEMS.more : NAV_ITEMS.more) : current;

  const item = (navItem: NavItem) => {
    const { href, label, icon: Icon } = navItem;
    const active = lit === navItem;
    return (
      <Link
        key={href}
        href={casa ? href : withMonth(href, params)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium',
          active ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        <Icon className="size-5" aria-hidden />
        <span className="truncate">{label}</span>
      </Link>
    );
  };

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-safe backdrop-blur md:hidden"
    >
      <div className="mx-auto flex h-16 max-w-md items-stretch px-2">
        {nav.left.map(item)}
        <div className="flex flex-1 items-center justify-center">
          {casa ? (
            <Link href="/casa/entrada" aria-label="Dar entrada no estoque" className={CENTER_BUTTON}>
              <PackagePlus className="size-6" aria-hidden />
            </Link>
          ) : (
            <NewEntrySheet>
              <button type="button" aria-label="Novo lançamento" className={CENTER_BUTTON}>
                <Plus className="size-6" aria-hidden />
              </button>
            </NewEntrySheet>
          )}
        </div>
        {nav.right.map(item)}
      </div>
    </nav>
  );
}
