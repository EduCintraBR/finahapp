import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Ellipsis, Pencil } from 'lucide-react';
import { EntryRowItem } from '@/components/entries/entry-list';
import { ActionButton } from '@/components/forms/action-button';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/money/amount';
import { EndTemplateForm } from '@/components/recurring/end-template-form';
import { TemplateForm } from '@/components/recurring/template-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SheetAction } from '@/components/ui/sheet-action';
import { getDb } from '@/db/client';
import { listActiveCards } from '@/db/queries/cards';
import { getTemplate, listOccurrences } from '@/db/queries/entries';
import { listCategories, listUsers } from '@/db/queries/lookups';
import { compareDates, formatMonthLabel, monthStart, today, toMonthParam } from '@/domain/dates';
import { formatDecimalBR } from '@/domain/money';
import { PAYMENT_METHOD_LABEL, RECURRING_TYPE_LABEL } from '@/lib/labels';
import { deleteTemplateAction } from '../actions';

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
      <PageHeader
        title={t.description}
        description={t.direction === 'INCOME' ? 'Receita prevista' : 'Conta a pagar'}
        back={{ href: '/fixos', label: 'Fixos' }}
        actions={
          <SheetAction
            label="Mais ações"
            description={t.description}
            iconOnly
            variant="ghost"
            icon={<Ellipsis aria-hidden />}
          >
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Excluir apaga este fixo e as contas dele que não foram pagas (pendentes e canceladas, de
                qualquer mês). As já pagas ficam no extrato e no saldo, só deixam de ser ligadas a um fixo.
              </p>
              <ActionButton
                action={deleteTemplateAction}
                fields={{ id: t.id }}
                variant="destructive"
                label="Excluir fixo"
                pendingLabel="Excluindo…"
                confirm={{
                  title: 'Excluir este fixo?',
                  description:
                    'O fixo e todas as contas dele ainda não pagas somem do histórico. As contas já pagas continuam no extrato e o saldo não muda. Fica registrado no histórico de alterações.',
                  confirmLabel: 'Excluir',
                }}
              />
            </div>
          </SheetAction>
        }
      />

      <Card className="gap-3 py-4">
        <CardContent className="space-y-2 px-4 sm:px-6">
          <Amount
            cents={t.amountCents}
            direction={t.direction === 'INCOME' ? 'in' : 'out'}
            className="block text-3xl font-semibold tracking-tight"
          />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1 text-sm">
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
        </CardContent>
      </Card>

      {/* só leitura; mudar e encerrar abrem painel (o vermelho cheio só dentro do "Encerrar") */}
      {!ended && (
        <div className="grid grid-cols-2 gap-2">
          <SheetAction
            label="Editar"
            title="Alterar a partir de um mês"
            description="Reajuste de aluguel, mudança de vencimento etc. Os meses anteriores ficam como estão."
            icon={<Pencil aria-hidden />}
          >
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
          </SheetAction>
          <SheetAction
            label="Encerrar"
            title="Encerrar este fixo"
            description="Para de gerar contas depois do mês escolhido (por exemplo, o mês atual). O que já foi gerado até lá continua no histórico."
          >
            <EndTemplateForm id={t.id} defaultMonth={toMonthParam(month)} />
          </SheetAction>
        </div>
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
                showDate
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
