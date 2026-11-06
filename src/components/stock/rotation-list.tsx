import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { RotationLot } from '@/db/queries/stock';
import type { ISODate } from '@/domain/dates';
import { ageText } from '@/domain/stock/rotation';
import { cn } from '@/lib/utils';
import { entryLabel, lotContentText } from './format';
import { CheckBadge, ExpiryBadge } from './stock-icons';

/** Lotes do rodízio (D85): produto e código, validade, conferência, idade e quanto tem. Um toque abre o lote. */
export function RotationList({
  lots,
  today,
  className,
}: {
  lots: RotationLot[];
  today: ISODate;
  className?: string;
}) {
  return (
    <ul className={cn('divide-y', className)} data-testid="rotation-lots">
      {lots.map((l) => (
        <li key={l.id}>
          <Link
            href={`/casa/lotes/${l.id}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:px-6"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex items-baseline gap-2">
                <span className="min-w-0 truncate font-medium">{l.productName}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{l.code}</span>
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <ExpiryBadge date={l.expiryDate} level={l.expiry} kind={l.expiryKind} />
                <CheckBadge date={l.nextCheck} due={l.checkDue} />
              </div>
              <p className="text-xs text-muted-foreground">
                {entryLabel(l.origin)} {ageText(l.entryDate, today)} · {lotContentText(l, l.measure)}
                {l.locationName && ` · ${l.locationName}`}
              </p>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
