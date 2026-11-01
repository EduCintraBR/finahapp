import type { Metadata } from 'next';
import { TemplateForm } from '@/components/recurring/template-form';
import { CardContent } from '@/components/ui/card';
import { FormCard } from '@/components/forms/form-card';
import { getDb } from '@/db/client';
import { listActiveCards } from '@/db/queries/cards';
import { listCategories, listUsers } from '@/db/queries/lookups';
import { today, toMonthParam } from '@/domain/dates';

export const metadata: Metadata = { title: 'Novo fixo' };

export default async function NewTemplatePage() {
  const db = getDb();
  const [categories, users, cards] = await Promise.all([
    listCategories(db),
    listUsers(db),
    listActiveCards(db),
  ]);
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Novo fixo ou recorrente</h1>
      <FormCard>
        <CardContent>
          <TemplateForm
            categories={categories}
            users={users}
            currentMonth={toMonthParam(today())}
            cards={cards.map((c) => ({ id: c.id, name: c.name }))}
          />
        </CardContent>
      </FormCard>
      <p className="text-center text-xs text-muted-foreground">
        Assinatura no cartão (Netflix, Spotify…): escolha “Cartão de crédito” como meio.
      </p>
    </div>
  );
}
