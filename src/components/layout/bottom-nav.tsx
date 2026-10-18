'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_ITEMS, NEW_ENTRY_HREF, isActive, type NavItem } from './nav-items';
import { withMonth } from './month-link';

const LEFT: NavItem[] = [NAV_ITEMS.home, NAV_ITEMS.entries];
const RIGHT: NavItem[] = [NAV_ITEMS.cards, NAV_ITEMS.reports];

/** Navegação inferior do celular (< md). O botão central é o "lançar". */
export function BottomNav() {
  const pathname = usePathname();
  const params = useSearchParams();

  const item = ({ href, label, icon: Icon }: NavItem) => {
    const active = isActive(pathname, href);
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
        {LEFT.map(item)}
        <div className="flex flex-1 items-center justify-center">
          <Link
            href={NEW_ENTRY_HREF}
            aria-label="Novo lançamento"
            className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md active:scale-95"
          >
            <Plus className="size-6" aria-hidden />
          </Link>
        </div>
        {RIGHT.map(item)}
      </div>
    </nav>
  );
}
