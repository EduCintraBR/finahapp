import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { OnboardingForm } from '@/components/cards/onboarding-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listCardSummaries } from '@/db/queries/cards';
import { listCategories, listUsers } from '@/db/queries/lookups';
import { today, toMonthParam } from '@/domain/dates';

export const metadata: Metadata = { title: 'Parcelamento em andamento' };

export default async function OnboardingPage({ params }: PageProps<'/cartoes/[id]/em-andamento'>) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const [[s], categories, users] = await Promise.all([
    listCardSummaries(db, today(), { cardId: id }),
    listCategories(db),
    listUsers(db),
  ]);
  if (!s) notFound();
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/cartoes/${id}`}>
          <ArrowLeft aria-hidden /> {s.card.name}
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Parcelamento em andamento</CardTitle>
          <CardDescription>
            Para compras parceladas feitas antes de começar a usar o Finah. Ex.: geladeira em 10x, já na
            parcela 9.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OnboardingForm
            cardId={id}
            categories={categories}
            users={users}
            currentMonth={toMonthParam(s.currentInvoice.referenceMonth)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
