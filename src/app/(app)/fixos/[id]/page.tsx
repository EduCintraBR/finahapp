import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { EntryRowItem } from '@/components/entries/entry-list';
import { Amount } from '@/components/money/amount';
import { EndTemplateForm } from '@/components/recurring/end-template-form';
import { TemplateForm } from '@/components/recurring/template-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listActiveCards } from '@/db/queries/cards';
import { getTemplate, listOccurrences } from '@/db/queries/entries';
import { listCategories, listUsers } from '@/db/queries/lookups';
import { compareDates, formatMonthLabel, monthStart, today, toMonthParam } from '@/domain/dates';
import { formatDecimalBR } from '@/domain/money';
import { PAYMENT_METHOD_LABEL, RECURRING_TYPE_LABEL } from '@/lib/labels';

export const metadata: Metadata = { title: 'Fixo' };

export default async function TemplatePage({ params }: PageProps<'/fixos/[id]'>) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const [t, users, occurrences, cards] = await Promise.all([
    getTemplate(db, id),
    listUsers(db),
    listOccurrences(db, [id]),
    listActiveCards(db),
  ]);
  if (!t) notFound();
  const categories = await listCategories(db, { alsoIds: [t.categoryId] });

  const hoje = today();
  const month = monthStart(hoje);
  const ended = !t.isActive || (t.endMonth !== null && compareDates(t.endMonth, month) < 0);
  const effectiveDefault = compareDates(t.startMonth, month) > 0 ? t.startMonth : month;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/fixos">
          <ArrowLeft aria-hidden /> Fixos
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardDescription>{t.direction === 'INCOME' ? 'Receita prevista' : 'Conta a pagar'}</CardDescription>
          <CardTitle className="text-xl">{t.description}</CardTitle>
          <Amount
            cents={t.amountCents}
            direction={t.direction === 'INCOME' ? 'in' : 'out'}
            className="text-3xl font-semibold"
          />
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Tipo</dt>
            <dd>{RECURRING_TYPE_LABEL[t.type]}</dd>
            <dt className="text-muted-foreground">Vencimento</dt>
            <dd>todo dia {t.dayOfMonth}</dd>
            <dt className="text-muted-foreground">Categoria</dt>
            <dd>
              {t.categoryName} · {PAYMENT_METHOD_LABEL[t.paymentMethod]}
            </dd>
            <dt className="text-muted-foreground">Período</dt>
            <dd className="first-letter:uppercase">
              {formatMonthLabel(t.startMonth)}
              {t.endMonth ? ` até ${formatMonthLabel(t.endMonth)}` : ' em diante'}
              {!t.isActive && ' (desativado)'}
            </dd>
          </dl>
        </CardHeader>
      </Card>

      {!ended && (
        <Card>
          <CardHeader>
            <CardTitle>Alterar a partir de um mês</CardTitle>
            <CardDescription>Reajuste de aluguel, mudança de vencimento etc.</CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateForm
              categories={categories}
              users={users}
              currentMonth={toMonthParam(effectiveDefault)}
              cards={cards.map((c) => ({ id: c.id, name: c.name }))}
              defaults={{
                id: t.id,
                direction: t.direction,
                type: t.type,
                description: t.description,
                categoryId: t.categoryId,
                amountText: formatDecimalBR(t.amountCents),
                dayOfMonth: t.dayOfMonth,
                paymentMethod: t.paymentMethod,
                creditCardId: t.creditCardId,
                beneficiaryUserId: t.beneficiaryUserId,
              }}
            />
          </CardContent>
        </Card>
      )}

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>Histórico</CardTitle>
        </CardHeader>
        <CardContent className="divide-y border-t px-0">
          {occurrences.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma conta gerada ainda.</p>
          ) : (
            occurrences.map((e) => (
              <EntryRowItem
                key={e.id}
                e={e}
                today={hoje}
                href={`/lancamentos/${e.id}?voltar=/fixos/${t.id}`}
              />
            ))
          )}
        </CardContent>
      </Card>

      {!ended && (
        <Card>
          <CardHeader>
            <CardTitle>Encerrar</CardTitle>
          </CardHeader>
          <CardContent>
            <EndTemplateForm id={t.id} defaultMonth={toMonthParam(month)} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
