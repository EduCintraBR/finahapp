'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { PackagePlus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AreaTabs } from './area-switch';
import { Logo } from './logo';
import { withMonth } from './month-link';
import { CASA_SIDEBAR_GROUPS, SIDEBAR_GROUPS, activeItem, areaOf } from './nav-items';
import { NewEntrySheet } from './new-entry-sheet';

const ALL = SIDEBAR_GROUPS.flatMap((g) => g.items);
const CASA_ALL = CASA_SIDEBAR_GROUPS.flatMap((g) => g.items);

/** Sidebar do desktop (≥ md): a troca de área (D81) e as seções da área, agrupadas. */
export function Sidebar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const casa = areaOf(pathname) === 'casa';
  const groups = casa ? CASA_SIDEBAR_GROUPS : SIDEBAR_GROUPS;
  const current = activeItem(pathname, casa ? CASA_ALL : ALL);

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r bg-sidebar text-sidebar-foreground md:flex">
      <div className="flex h-16 items-center px-5">
        <Logo />
      </div>
      <div className="space-y-3 px-3 pb-4">
        <AreaTabs />
        {casa ? (
          <Button asChild className="w-full">
            <Link href="/casa/entrada">
              <PackagePlus aria-hidden /> Dar entrada
            </Link>
          </Button>
        ) : (
          <NewEntrySheet>
            <Button className="w-full">
              <Plus aria-hidden /> Novo lançamento
            </Button>
          </NewEntrySheet>
        )}
      </div>
      <nav aria-label="Navegação principal" className="flex flex-1 flex-col gap-4 px-3 pb-4">
        {groups.map((group, i) => (
          <div
            key={group.title ?? i}
            className={cn('flex flex-col gap-1', !group.title && i > 0 && 'mt-auto')}
          >
            {group.title && (
              <p className="px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground/70 uppercase">
                {group.title}
              </p>
            )}
            {group.items.map((navItem) => {
              const { href, label, icon: Icon } = navItem;
              const active = current === navItem;
              return (
                <Link
                  key={href}
                  href={casa ? href : withMonth(href, params)}
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
          </div>
        ))}
      </nav>
    </aside>
  );
}
