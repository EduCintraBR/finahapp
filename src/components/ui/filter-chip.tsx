'use client';

import Link from 'next/link';
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

export type FilterOption = { label: string; href: string; active: boolean };

/**
 * Filtro em botão (FilterChips): mostra o valor escolhido (ou o nome do filtro) e abre um painel inferior com as
 * opções. Cada opção é um link (a URL guarda os filtros), então funciona com voltar/avançar e dá para compartilhar.
 */
export function FilterChip({
  label,
  value,
  options,
}: {
  label: string;
  value?: string;
  options: FilterOption[];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={value ? `${label}: ${value}` : label}
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            value
              ? 'border-primary/60 bg-primary/10 font-medium text-primary'
              : 'text-muted-foreground hover:bg-accent',
          )}
        >
          {value ?? label}
          <ChevronDown className="size-3.5 opacity-70" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription className="sr-only">Escolha uma opção para filtrar a lista.</DialogDescription>
        </DialogHeader>
        <ul className="-mx-2 max-h-[60dvh] overflow-y-auto">
          {options.map((o) => (
            <li key={o.href}>
              <DialogClose asChild>
                <Link
                  href={o.href}
                  scroll={false}
                  aria-current={o.active ? 'true' : undefined}
                  className={cn(
                    'flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-accent',
                    o.active && 'font-medium text-primary',
                  )}
                >
                  {o.label}
                  {o.active && <Check className="size-4 shrink-0" aria-hidden />}
                </Link>
              </DialogClose>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
