import Link from 'next/link';
import { ChevronRight, MapPin } from 'lucide-react';
import type { ProductSummary } from '@/db/queries/stock';
import { cn } from '@/lib/utils';
import { quantityText } from './format';
import { ExpiryBadge, LowBadge } from './stock-icons';

/** Linhas de produto: nome, quanto tem (na medida e em embalagens), onde fica e a próxima validade. */
export function ProductList({
  products,
  showCategory = false,
  className,
}: {
  products: ProductSummary[];
  /** na busca e na lista de tudo: mostra "Alimentos › Grãos" */
  showCategory?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn('divide-y', className)} data-testid="stock-products">
      {products.map((p) => {
        const q = quantityText(p);
        return (
          <li key={p.id}>
            <Link
              href={`/casa/produtos/${p.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-6"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{p.name}</span>
                  <span
                    className={cn(
                      'shrink-0 text-right text-sm font-medium tabular-nums',
                      p.packages === 0 && 'text-muted-foreground',
                    )}
                  >
                    {q.main}
                  </span>
                </div>
                {(p.activeIngredient || p.strength) && (
                  <p className="truncate text-xs text-muted-foreground">
                    {[p.activeIngredient, p.strength].filter(Boolean).join(' · ')}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {showCategory && <span>{p.categoryLabel}</span>}
                  {p.locationNames.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" aria-hidden />
                      {p.locationNames.join(', ')}
                    </span>
                  )}
                  {q.packages && <span className="tabular-nums">{q.packages}</span>}
                  {p.people.length > 0 && <span>Para {p.people.map((x) => x.name).join(', ')}</span>}
                  {p.low && <LowBadge />}
                  <ExpiryBadge date={p.nextExpiry} level={p.expiry} kind={p.expiryKind} />
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
