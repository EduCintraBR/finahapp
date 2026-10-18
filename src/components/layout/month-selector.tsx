'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { addMonths, formatMonthLabel, parseMonthParam, toMonthParam, type ISODate } from '@/domain/dates';
import { cn } from '@/lib/utils';
import { MONTH_PARAM } from './month-link';

/**
 * Seletor de mês global (?mes=AAAA-MM). Sem parâmetro = mês atual.
 * `currentMonth` vem do servidor (today() em America/Sao_Paulo), nunca do relógio do aparelho.
 */
export function MonthSelector({ currentMonth, className }: { currentMonth: ISODate; className?: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = parseMonthParam(params.get(MONTH_PARAM)) ?? currentMonth;

  const hrefFor = (month: ISODate) => {
    const next = new URLSearchParams(params.toString());
    if (month === currentMonth) next.delete(MONTH_PARAM);
    else next.set(MONTH_PARAM, toMonthParam(month));
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const isCurrent = selected === currentMonth;

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Button asChild variant="ghost" size="icon" aria-label="Mês anterior">
        <Link href={hrefFor(addMonths(selected, -1))} scroll={false}>
          <ChevronLeft />
        </Link>
      </Button>
      <Link
        href={hrefFor(currentMonth)}
        scroll={false}
        title={isCurrent ? undefined : 'Voltar para o mês atual'}
        className="min-w-36 rounded-md px-2 py-1 text-center text-sm font-medium first-letter:uppercase"
        aria-live="polite"
      >
        {formatMonthLabel(selected)}
        {!isCurrent && <span className="ml-1 align-middle text-xs text-primary">•</span>}
      </Link>
      <Button asChild variant="ghost" size="icon" aria-label="Próximo mês">
        <Link href={hrefFor(addMonths(selected, 1))} scroll={false}>
          <ChevronRight />
        </Link>
      </Button>
    </div>
  );
}
