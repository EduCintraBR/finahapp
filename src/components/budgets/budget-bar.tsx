import { Amount } from '@/components/money/amount';
import type { BudgetLevel } from '@/domain/budgets/budgets';
import { formatBRL } from '@/domain/money';
import { cn } from '@/lib/utils';

export const LEVEL_LABEL: Record<BudgetLevel, string> = {
  ok: 'No controle',
  warning: 'Perto do limite',
  over: 'Passou',
};

/** Cor de cada situação: identidade nunca só pela cor (o selo e o texto dizem a situação). */
export const LEVEL_FILL: Record<BudgetLevel, string> = {
  ok: 'bg-income',
  warning: 'bg-warning',
  over: 'bg-expense',
};

export function LevelBadge({ level, className }: { level: BudgetLevel; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
        level === 'ok' && 'bg-income/15 text-income',
        level === 'warning' && 'bg-warning/20 text-warning-text',
        level === 'over' && 'bg-expense/15 text-expense',
        className,
      )}
    >
      {LEVEL_LABEL[level]}
    </span>
  );
}

/**
 * Barra do orçamento (D79): quanto do limite já foi (Gasto Mensal), com o que falta ou o quanto passou.
 * Acima do limite a barra fica cheia e o texto diz quanto passou.
 */
export function BudgetBar({
  spentCents,
  limitCents,
  level,
  percent,
  remainingCents,
  size = 'md',
}: {
  spentCents: number;
  limitCents: number;
  level: BudgetLevel;
  percent: number;
  remainingCents: number;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="space-y-1.5">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(percent, 100)}
        aria-valuetext={`${percent}% do orçamento: ${formatBRL(spentCents)} de ${formatBRL(limitCents)}`}
        className={cn('overflow-hidden rounded-full bg-muted', size === 'sm' ? 'h-2' : 'h-3')}
      >
        <div
          className={cn('h-full rounded-full transition-[width]', LEVEL_FILL[level])}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
        <span>
          <Amount cents={spentCents} className="font-medium text-foreground" /> de{' '}
          <Amount cents={limitCents} /> · {percent}%
        </span>
        <span className={cn(level === 'over' && 'font-medium text-expense')}>
          {remainingCents >= 0 ? (
            <>
              Falta <Amount cents={remainingCents} />
            </>
          ) : (
            <>
              Passou <Amount cents={-remainingCents} />
            </>
          )}
        </span>
      </div>
    </div>
  );
}
