import Link from 'next/link';
import { Suspense } from 'react';
import type { ISODate } from '@/domain/dates';
import { Toaster } from '@/components/ui/toaster';
import { BottomNav } from './bottom-nav';
import { Logo } from './logo';
import { MonthSelector } from './month-selector';
import { ThemeQuickToggle } from '@/components/theme/theme-controls';
import { NAV_ITEMS } from './nav-items';
import { Sidebar } from './sidebar';

export function AppShell({
  user,
  currentMonth,
  children,
}: {
  user: { name: string };
  currentMonth: ISODate;
  children: React.ReactNode;
}) {
  const initial = user.name.trim().charAt(0).toUpperCase() || '?';
  return (
    <div className="flex min-h-dvh">
      <Suspense>
        <Sidebar />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b bg-background/95 pt-safe backdrop-blur">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4">
            <div className="md:hidden">
              <Logo />
            </div>
            {/* o meio do cabeçalho existe mesmo nas telas sem seletor de mês: tema e perfil ficam sempre à direita */}
            <div className="flex min-w-0 flex-1 justify-center md:justify-start">
              <Suspense fallback={<div className="h-9" />}>
                <MonthSelector currentMonth={currentMonth} className="md:-ml-2" />
              </Suspense>
            </div>
            <div className="flex items-center gap-1">
              <ThemeQuickToggle />
              <Link
                href={NAV_ITEMS.settings.href}
                aria-label={`${user.name} — ajustes`}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground"
              >
                {initial}
              </Link>
            </div>
          </div>
        </header>
        {/* pb-24: espaço para a navegação inferior no celular */}
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-24 md:pb-8">{children}</main>
      </div>
      <Suspense>
        <BottomNav />
      </Suspense>
      <Toaster />
    </div>
  );
}
