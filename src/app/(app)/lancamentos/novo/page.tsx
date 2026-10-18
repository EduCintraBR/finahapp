import type { Metadata } from 'next';
import { EntryForm } from '@/components/entries/entry-form';
import { Card, CardContent } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listActiveCards } from '@/db/queries/cards';
import { listCategories, listUsers } from '@/db/queries/lookups';
import { today } from '@/domain/dates';

export const metadata: Metadata = { title: 'Novo lançamento' };

export default async function NewEntryPage({ searchParams }: PageProps<'/lancamentos/novo'>) {
  const { tipo } = await searchParams;
  const db = getDb();
  const [categories, users, cards] = await Promise.all([
    listCategories(db),
    listUsers(db),
    listActiveCards(db),
  ]);
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Novo lançamento</h1>
      <Card>
        <CardContent>
          <EntryForm
            categories={categories}
            users={users}
            today={today()}
            returnTo="/lancamentos"
            cards={cards.map((c) => ({ id: c.id, name: c.name }))}
            initialMode={tipo === 'cartao' ? 'CARD' : undefined}
          />
        </CardContent>
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        Contas que se repetem todo mês (inclusive assinaturas no cartão): cadastre em Fixos.
      </p>
    </div>
  );
}
