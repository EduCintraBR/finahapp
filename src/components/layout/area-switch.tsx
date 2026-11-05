'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, ChevronDown } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { AREAS, areaOf, type Area } from './nav-items';

const ORDER: Area[] = ['financas', 'casa'];

/** Sidebar do desktop: as duas áreas lado a lado (D81). */
export function AreaTabs() {
  const current = areaOf(usePathname());
  return (
    <nav aria-label="Área do app" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
      {ORDER.map((a) => {
        const { href, label, icon: Icon } = AREAS[a];
        const active = a === current;
        return (
          <Link
            key={a}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Celular: o logo do cabeçalho abre a escolha da área (Finanças ou Casa). Ocupa o lugar do logo, para o cabeçalho
 * continuar cabendo o seletor de mês, o tema e o perfil em 375px.
 */
export function AreaMenu() {
  const current = areaOf(usePathname());
  const CurrentIcon = AREAS[current].icon;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Área: ${AREAS[current].label}. Trocar de área`}
          className="flex items-center gap-1 rounded-md py-1 pr-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG estático pequeno */}
          <img src="/icon.svg" alt="" width={28} height={28} className="rounded-md" />
          <CurrentIcon className="size-4 text-muted-foreground" aria-hidden />
          <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ir para</DialogTitle>
          <DialogDescription className="sr-only">Escolha a área do app.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {ORDER.map((a) => {
            const { href, label, description, icon: Icon } = AREAS[a];
            const active = a === current;
            return (
              <li key={a}>
                <DialogClose asChild>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-accent',
                      active && 'border-primary/60 bg-primary/5',
                    )}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{label}</span>
                      <span className="block text-sm text-muted-foreground">{description}</span>
                    </span>
                    {active && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
                  </Link>
                </DialogClose>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
