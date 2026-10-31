'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BOTTOM_NAV, MORE_ITEMS, NAV_ITEMS, activeItem, type NavItem } from './nav-items';
import { withMonth } from './month-link';
import { NewEntrySheet } from './new-entry-sheet';

const ALL = [...BOTTOM_NAV.left, ...BOTTOM_NAV.right, ...MORE_ITEMS];

/** Navegação inferior do celular (< md). O botão central abre o painel de "lançar". */
export function BottomNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = activeItem(pathname, ALL);
  // as telas do "Mais" (Cartões, Fixos, Ajustes…) acendem o "Mais"
  const lit = current && MORE_ITEMS.includes(current) ? NAV_ITEMS.more : current;

  const item = (navItem: NavItem) => {
    const { href, label, icon: Icon } = navItem;
    const active = lit === navItem;
    return (
      <Link
        key={href}
        href={withMonth(href, params)}
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
        {BOTTOM_NAV.left.map(item)}
        <div className="flex flex-1 items-center justify-center">
          <NewEntrySheet>
            <button
              type="button"
              aria-label="Novo lançamento"
              className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md active:scale-95"
            >
              <Plus className="size-6" aria-hidden />
            </button>
          </NewEntrySheet>
        </div>
        {BOTTOM_NAV.right.map(item)}
      </div>
    </nav>
  );
}
