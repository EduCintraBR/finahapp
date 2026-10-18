'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Logo } from './logo';
import { withMonth } from './month-link';
import { NAV_ITEMS, NEW_ENTRY_HREF, isActive } from './nav-items';

/** Sidebar do desktop (≥ md). */
export function Sidebar() {
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-16 items-center px-5">
        <Logo />
      </div>
      <div className="px-3 pb-4">
        <Button asChild className="w-full">
          <Link href={NEW_ENTRY_HREF}>
            <Plus aria-hidden /> Novo lançamento
          </Link>
        </Button>
      </div>
      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-1 px-3">
        {Object.values(NAV_ITEMS).map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={withMonth(href, params)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
