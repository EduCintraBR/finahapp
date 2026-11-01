'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Faixa que rola de lado e abre já centrada no item marcado com `data-current` (ex.: a fatura atual, com as
 * passadas à esquerda e as futuras à direita).
 */
export function ScrollStrip({ className, children, ...props }: React.ComponentProps<'div'>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = ref.current;
    const current = strip?.querySelector<HTMLElement>('[data-current]');
    if (!strip || !current) return;
    strip.scrollLeft = current.offsetLeft - (strip.clientWidth - current.offsetWidth) / 2;
  }, []);
  return (
    <div
      ref={ref}
      className={cn('relative flex snap-x [scrollbar-width:none] gap-3 overflow-x-auto', className)}
      {...props}
    >
      {children}
    </div>
  );
}
