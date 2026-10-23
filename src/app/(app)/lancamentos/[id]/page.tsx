import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Repeat } from 'lucide-react';
import { ConfirmPaymentDialog } from '@/components/entries/confirm-payment-dialog';
import { EntryForm } from '@/components/entries/entry-form';
import { HighlightBadge } from '@/components/entries/entry-list';
import { ActionButton } from '@/components/forms/action-button';
import { Amount, directionOf } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { getEntry, planIdOfTransaction } from '@/db/queries/entries';
import { isScheduled } from '@/domain/account/rules';
import { listCategories, listUsers } from '@/db/queries/lookups';
import { formatDateBR, today } from '@/domain/dates';
import { formatBRL, formatDecimalBR } from '@/domain/money';
import { KIND_LABEL, STATUS_LABEL } from '@/lib/labels';
import { removeEntryAction, revertPaymentAction } from '../actions';

export const metadata: Metadata = { title: 'Lançamento' };

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: 'pelo app',
  BOT: 'pelo bot',
  RECURRING: 'automaticamente (fixo)',
  SYSTEM: 'pelo sistema',
  IMPORT: 'por importação',
  ONBOARDING: 'no cadastro inicial',
};

export default async function EntryPage({ params, searchParams }: PageProps<'/lancamentos/[id]'>) {
  const { id } = await params;
  const { voltar } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const [entry, users] = await Promise.all([getEntry(db, id), listUsers(db)]);
  if (!entry || entry.categoryId === undefined) notFound();
  // a categoria atual continua escolhível mesmo arquivada (D49)
  const categories = await listCategories(db, { alsoIds: [entry.categoryId] });
  if (entry.creditCardId) {
    const planId = await planIdOfTransaction(db, entry.id);
    if (planId) redirect(`/cartoes/compras/${planId}`);
  }

  const back =
    typeof voltar === 'string' && voltar.startsWith('/') && !voltar.startsWith('//')
      ? voltar
      : '/lancamentos';
  const hoje = today();
  const editable = (entry.kind === 'INCOME' || entry.kind === 'EXPENSE') && entry.status !== 'CANCELLED';
  const pending = entry.status === 'PENDING';
  const isOccurrence = entry.recurringTemplateId !== null;
  const income = entry.kind === 'INCOME';
  const fields = { id: entry.id, version: entry.version, returnTo: back };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={back}>
          <ArrowLeft aria-hidden /> Voltar
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={pending ? 'outline' : entry.status === 'CANCELLED' ? 'destructive' : 'secondary'}>
              {isScheduled(entry, today()) ? 'Agendado' : STATUS_LABEL[entry.status]}
            </Badge>
            {pending && <HighlightBadge dueDate={entry.dueDate} today={hoje} />}
            {isOccurrence && (
              <Link
                href={`/fixos/${entry.recurringTemplateId}`}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Repeat className="size-3" aria-hidden /> ver fixo
              </Link>
            )}
          </div>
          <CardTitle className="text-xl">{entry.description}</CardTitle>
          <Amount
            cents={entry.amountCents}
            direction={directionOf(entry.kind)}
            className="text-3xl font-semibold"
          />
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Tipo</dt>
            <dd>
              {entry.categoryName
                ? `${KIND_LABEL[entry.kind]} · ${entry.categoryName}`
                : KIND_LABEL[entry.kind]}
            </dd>
            {entry.dueDate && (
              <>
                <dt className="text-muted-foreground">Vencimento</dt>
                <dd>{formatDateBR(entry.dueDate)}</dd>
              </>
            )}
            {entry.postedDate && (
              <>
                <dt className="text-muted-foreground">{income ? 'Recebido em' : 'Pago em'}</dt>
                <dd>{formatDateBR(entry.postedDate)}</dd>
              </>
            )}
            {entry.estimatedAmountCents !== null && entry.estimatedAmountCents !== entry.amountCents && (
              <>
                <dt className="text-muted-foreground">Estimado</dt>
                <dd>{formatBRL(entry.estimatedAmountCents)}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Lançado</dt>
            <dd>
              por {entry.createdByName} {SOURCE_LABEL[entry.source] ?? ''}
            </dd>
            <dt className="text-muted-foreground">De quem é</dt>
            <dd>{entry.beneficiaryName ?? 'Casal'}</dd>
          </dl>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {pending && (
            <ConfirmPaymentDialog
              id={entry.id}
              version={entry.version}
              description={entry.description}
              income={income}
              amountText={formatDecimalBR(entry.amountCents)}
              today={hoje}
              trigger={
                <Button className="w-full sm:w-auto">
                  {income ? 'Confirmar recebimento' : 'Confirmar pagamento'}
                </Button>
              }
            />
          )}
          {entry.status === 'POSTED' && entry.dueDate && editable && (
            <ActionButton
              action={revertPaymentAction}
              fields={fields}
              label="Estornar baixa"
              confirm={{
                title: 'Estornar a baixa?',
                description: `O lançamento volta a ficar pendente${
                  entry.estimatedAmountCents !== null
                    ? ` com o valor estimado (${formatBRL(entry.estimatedAmountCents)})`
                    : ''
                } e sai do saldo.`,
                confirmLabel: 'Estornar',
              }}
            />
          )}
          {editable && (
            <ActionButton
              action={removeEntryAction}
              fields={fields}
              variant="destructive"
              label={isOccurrence ? 'Cancelar esta ocorrência' : 'Excluir'}
              confirm={
                isOccurrence
                  ? {
                      title: 'Cancelar esta ocorrência?',
                      description:
                        'Ela não vai mais aparecer neste mês. O fixo continua valendo nos outros meses.',
                      confirmLabel: 'Cancelar ocorrência',
                    }
                  : {
                      title: 'Excluir lançamento?',
                      description:
                        'Ele sai do saldo e do extrato (fica registrado no histórico de auditoria).',
                      confirmLabel: 'Excluir',
                    }
              }
            />
          )}
        </CardContent>
      </Card>

      {editable && (
        <Card>
          <CardHeader>
            <CardTitle>Editar</CardTitle>
          </CardHeader>
          <CardContent>
            <EntryForm
              categories={categories}
              users={users}
              today={hoje}
              returnTo={back}
              defaults={{
                id: entry.id,
                version: entry.version,
                kind: entry.kind as 'INCOME' | 'EXPENSE',
                amountText: formatDecimalBR(entry.amountCents),
                description: entry.description,
                categoryId: entry.categoryId ?? '',
                paymentMethod: entry.paymentMethod,
                date: pending ? entry.dueDate! : (entry.postedDate ?? entry.transactionDate),
                beneficiaryUserId: entry.beneficiaryId,
                notes: entry.notes,
                pending,
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
