import Link from 'next/link';
import { Amount, directionOf } from '@/components/money/amount';
import { ShowMoreList } from '@/components/ui/show-more-list';
import type { EntryRow } from '@/db/queries/entries';
import type { ISODate } from '@/domain/dates';
import { formatDecimalBR } from '@/domain/money';
import { ConfirmPaymentDialog, type PayWithWallet } from './confirm-payment-dialog';
import { DueText } from './entry-list';

/**
 * Pendentes com baixa rápida (2 toques a partir da Início: "Paguei" → "Confirmar"). O nome usa a linha toda; valor
 * e vencimento vão embaixo. Com `limit`, mostra os primeiros e abre o resto no lugar.
 */
export function PendingList({
  entries,
  today,
  wallets = [],
  limit,
}: {
  entries: EntryRow[];
  today: ISODate;
  wallets?: PayWithWallet[];
  limit?: number;
}) {
  if (entries.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nada pendente. 🎉</p>;
  }
  const items = entries.map((e) => (
    <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
      <Link href={`/lancamentos/${e.id}`} className="min-w-0 flex-1">
        <div className="truncate font-medium">{e.description}</div>
        <div className="flex items-center gap-1.5 text-xs">
          <Amount cents={e.amountCents} direction={directionOf(e.kind)} className="font-medium" />
          <span className="text-muted-foreground" aria-hidden>
            ·
          </span>
          <DueText dueDate={e.dueDate!} today={today} />
        </div>
      </Link>
      <ConfirmPaymentDialog
        id={e.id}
        version={e.version}
        description={e.description}
        income={e.kind === 'INCOME'}
        amountText={formatDecimalBR(e.amountCents)}
        today={today}
        wallets={e.loanId === null ? wallets : []}
      />
    </li>
  ));
  return limit ? (
    <ShowMoreList limit={limit} noun="pendentes" className="divide-y">
      {items}
    </ShowMoreList>
  ) : (
    <ul className="divide-y">{items}</ul>
  );
}
