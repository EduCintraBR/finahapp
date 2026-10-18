import Link from 'next/link';
import { Amount, directionOf } from '@/components/money/amount';
import type { EntryRow } from '@/db/queries/entries';
import { formatDateBR, type ISODate } from '@/domain/dates';
import { formatDecimalBR } from '@/domain/money';
import { ConfirmPaymentDialog } from './confirm-payment-dialog';
import { HighlightBadge } from './entry-list';

/** Pendentes com baixa rápida (2 toques a partir da Home: "Paguei" → "Confirmar"). */
export function PendingList({ entries, today }: { entries: EntryRow[]; today: ISODate }) {
  if (entries.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nada pendente. 🎉</p>;
  }
  return (
    <ul className="divide-y">
      {entries.map((e) => (
        <li key={e.id} className="flex items-center gap-3 px-4 py-3">
          <Link href={`/lancamentos/${e.id}`} className="min-w-0 flex-1">
            <div className="truncate font-medium">{e.description}</div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>vence {formatDateBR(e.dueDate!).slice(0, 5)}</span>
              <HighlightBadge dueDate={e.dueDate} today={today} />
            </div>
          </Link>
          <Amount cents={e.amountCents} direction={directionOf(e.kind)} className="text-sm font-medium" />
          <ConfirmPaymentDialog
            id={e.id}
            version={e.version}
            description={e.description}
            income={e.kind === 'INCOME'}
            amountText={formatDecimalBR(e.amountCents)}
            today={today}
          />
        </li>
      ))}
    </ul>
  );
}
