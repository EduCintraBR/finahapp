import type { Metadata } from 'next';
import Link from 'next/link';
import { CreditCard, Plus } from 'lucide-react';
import { CardSummaryCard } from '@/components/cards/card-summary';
import { Button } from '@/components/ui/button';
import { getDb } from '@/db/client';
import { listCardMonthViews } from '@/db/queries/cards';
import { monthSuffix } from '@/components/layout/month-link';
import { monthStart, today } from '@/domain/dates';
import { resolveMonth } from '@/lib/month';
import { ensureOccurrences } from '@/server/ensure-occurrences';

export const metadata: Metadata = { title: 'Cartões' };

export default async function CardsPage({ searchParams }: PageProps<'/cartoes'>) {
  await ensureOccurrences(); // assinaturas no cartão do mês
  const hoje = today();
  const month = await resolveMonth(searchParams);
  const summaries = await listCardMonthViews(getDb(), hoje, month);
  const suffix = monthSuffix(month, monthStart(hoje));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Cartões</h1>
        <div className="flex gap-1">
          {summaries.length > 0 && (
            <Button asChild size="sm" variant="ghost">
              <Link href="/lancamentos/novo?tipo=cartao">
                <CreditCard aria-hidden /> Compra
              </Link>
            </Button>
          )}
          <Button asChild size="sm">
            <Link href="/cartoes/novo">
              <Plus aria-hidden /> Cartão
            </Link>
          </Button>
        </div>
      </div>
      {summaries.length === 0 ? (
        <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhum cartão cadastrado. Cadastre o primeiro com os dias de fechamento e vencimento da fatura.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {summaries.map((s) => (
            <CardSummaryCard key={s.card.id} s={s} href={`/cartoes/${s.card.id}${suffix}`} />
          ))}
        </div>
      )}
    </div>
  );
}
