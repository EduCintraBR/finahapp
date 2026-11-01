'use client';

import { Children, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Lista (`<ul>`) que mostra só os `limit` primeiros itens e abre o resto no lugar, com um toque. */
export function ShowMoreList({
  limit,
  noun,
  className,
  children,
}: {
  limit: number;
  /** plural do que a lista mostra, para o botão: "Ver todos os 7 {noun}" */
  noun: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const items = Children.toArray(children);
  const hidden = items.length - limit;
  return (
    <>
      <ul className={className}>{open || hidden <= 0 ? items : items.slice(0, limit)}</ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center justify-center gap-1 border-t px-4 py-2.5 text-sm font-medium text-primary transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
        >
          {open ? 'Ver menos' : `Ver todos os ${items.length} ${noun}`}
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
        </button>
      )}
    </>
  );
}
