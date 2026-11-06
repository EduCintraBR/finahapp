import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';
import type { ShoppingItem } from '@/db/queries/stock';
import { formatAmount, formatPackages } from '@/domain/stock/measure';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LowBadge } from './stock-icons';

/** "6 pacotes de 5 kg" / "4 un": as embalagens que cobrem a falta, pelo conteúdo de costume do produto. */
function suggestionText(item: ShoppingItem): string | null {
  const { packages } = item.need;
  if (packages === null) return null;
  const text = formatPackages(packages, item.defaultPackage ?? 'un');
  return item.defaultContent ? `${text} de ${formatAmount(item.measure, item.defaultContent)}` : text;
}

/** Entrada já preenchida com a quantidade sugerida ("Comprei"). */
export function boughtHref(item: ShoppingItem): string {
  const base = `/casa/entrada?produto=${item.id}`;
  return item.need.packages === null ? base : `${base}&embalagens=${item.need.packages}`;
}

/** Lista de compras (D86): quanto tem, quanto falta para a meta, o que comprar e "Comprei" com a entrada pronta. */
export function ShoppingList({ items, className }: { items: ShoppingItem[]; className?: string }) {
  return (
    <ul className={cn('divide-y', className)} data-testid="shopping-list">
      {items.map((item) => {
        const suggestion = suggestionText(item);
        return (
          <li key={item.id} className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <Link href={`/casa/produtos/${item.id}`} className="min-w-0 flex-1 space-y-1 hover:opacity-80">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 truncate font-medium">{item.name}</span>
                {item.need.belowMin && <LowBadge />}
              </p>
              <p className="text-sm font-medium tabular-nums">
                Falta {formatAmount(item.measure, item.need.missing)}
                {suggestion && <span className="text-muted-foreground"> · comprar {suggestion}</span>}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                Tem {item.packages === 0 ? 'nada' : formatAmount(item.measure, item.total)}
                {item.targetQuantity !== null
                  ? ` · meta ${formatAmount(item.measure, item.targetQuantity)}`
                  : ` · mínimo ${formatAmount(item.measure, item.need.reference)}`}
              </p>
            </Link>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href={boughtHref(item)} aria-label={`Comprei ${item.name}`}>
                <ShoppingCart aria-hidden /> Comprei
              </Link>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
