import { formatBRL, type Cents } from '@/domain/money';
import { cn } from '@/lib/utils';

/** Valor em BRL. `direction` colore e põe o sinal: entrada (+, verde) ou saída (−, vermelho). */
export function Amount({
  cents,
  direction,
  className,
  'data-testid': testId,
}: {
  cents: Cents;
  direction?: 'in' | 'out';
  className?: string;
  'data-testid'?: string;
}) {
  const text = formatBRL(cents);
  return (
    <span
      data-testid={testId}
      className={cn(
        'whitespace-nowrap tabular-nums',
        direction === 'in' && 'text-income',
        direction === 'out' && 'text-expense',
        className,
      )}
    >
      {direction === 'in' ? '+ ' : direction === 'out' ? '− ' : ''}
      {text}
    </span>
  );
}

const INFLOW = new Set(['INCOME', 'TRANSFER_IN', 'ADJUSTMENT_IN']);
export const directionOf = (kind: string): 'in' | 'out' => (INFLOW.has(kind) ? 'in' : 'out');
