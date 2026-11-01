import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Ellipsis, Pencil, Repeat } from 'lucide-react';
import { ConfirmPaymentDialog } from '@/components/entries/confirm-payment-dialog';
import { EntryForm } from '@/components/entries/entry-form';
import { HighlightBadge } from '@/components/entries/entry-list';
import { ActionButton } from '@/components/forms/action-button';
import { Amount, directionOf } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { SheetAction } from '@/components/ui/sheet-action';
import { getDb } from '@/db/client';
import { listBenefitCards, payableWallets } from '@/db/queries/benefits';
import { getAnticipationLink, getEntry, planIdOfTransaction } from '@/db/queries/entries';
import { paymentAdjustment } from '@/domain/account/early-payment';
import { isScheduled } from '@/domain/account/rules';
import { listCategories, listUsers } from '@/db/queries/lookups';
import { formatDateBR, monthStart, today } from '@/domain/dates';
import { formatBRL, formatDecimalBR } from '@/domain/money';
import { KIND_LABEL, PAYMENT_METHOD_LABEL, STATUS_LABEL } from '@/lib/labels';
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
  const editable =
    (entry.kind === 'INCOME' || entry.kind === 'EXPENSE') &&
    entry.status !== 'CANCELLED' &&
    entry.status !== 'ANTICIPATED';
  // pagamento antecipado (D70): o vínculo entre a conta original (vencimento) e o pagamento (mês em que saiu o dinheiro)
  const link = await getAnticipationLink(db, entry);
  const isPayment = entry.anticipatesId !== null;
  const adjustment =
    isPayment && entry.estimatedAmountCents !== null
      ? paymentAdjustment(entry.estimatedAmountCents, entry.amountCents)
      : null;
  const pending = entry.status === 'PENDING';
  const isOccurrence = entry.recurringTemplateId !== null;
  const income = entry.kind === 'INCOME';
  const fields = { id: entry.id, version: entry.version, returnTo: back };
  // despesa pendente pode ser paga com uma carteira do cartão de benefícios (D69)
  const wallets =
    pending && !income && entry.loanId === null
      ? payableWallets(await listBenefitCards(db, hoje, monthStart(hoje)))
      : [];
  // despesa lançada no app que nasceu paga pode voltar a "a pagar" (D69)
  const canReopen =
    entry.status === 'POSTED' &&
    !entry.dueDate &&
    entry.kind === 'EXPENSE' &&
    entry.loanId === null &&
    entry.benefitWalletId === null &&
    !isPayment &&
    (entry.source === 'MANUAL' || entry.source === 'BOT') &&
    editable;

  const removeConfirm = isOccurrence
    ? {
        title: 'Cancelar esta ocorrência?',
        description: 'Ela não vai mais aparecer neste mês. O fixo continua valendo nos outros meses.',
        confirmLabel: 'Cancelar ocorrência',
      }
    : {
        title: 'Excluir lançamento?',
        description: 'Ele sai do saldo e do extrato (fica registrado no histórico de auditoria).',
        confirmLabel: 'Excluir',
      };
  const canRemove = editable && !isPayment;
  // ações raras ficam no menu "⋯"; a principal (dar baixa, estornar) fica à vista
  const hasMore = canReopen || canRemove;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={entry.description}
        back={{ href: back, label: 'Voltar' }}
        actions={
          hasMore && (
            <SheetAction
              label="Mais ações"
              description={entry.description}
              iconOnly
              variant="ghost"
              icon={<Ellipsis aria-hidden />}
            >
              <div className="grid gap-2">
                {canReopen && (
                  <ActionButton
                    action={revertPaymentAction}
                    fields={fields}
                    label="Marcar como a pagar"
                    confirm={{
                      title: 'Marcar como a pagar?',
                      description:
                        'O lançamento volta a ficar pendente, vencendo na data em que foi lançado, e sai do saldo até você dar baixa em "Paguei".',
                      confirmLabel: 'Marcar como a pagar',
                    }}
                  />
                )}
                {canRemove && (
                  <ActionButton
                    action={removeEntryAction}
                    fields={fields}
                    variant="destructive"
                    label={isOccurrence ? 'Cancelar esta ocorrência' : 'Excluir'}
                    confirm={removeConfirm}
                  />
                )}
              </div>
            </SheetAction>
          )
        }
      />

      <Card className="gap-3 py-4">
        <CardContent className="space-y-2 px-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={pending ? 'outline' : entry.status === 'CANCELLED' ? 'destructive' : 'secondary'}>
              {isScheduled(entry, hoje)
                ? 'Agendado'
                : isPayment
                  ? 'Pago antecipado'
                  : STATUS_LABEL[entry.status]}
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
          <Amount
            cents={entry.amountCents}
            direction={directionOf(entry.kind)}
            className="block text-3xl font-semibold tracking-tight"
          />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-1 text-sm sm:grid-cols-[auto_1fr_auto_1fr] sm:gap-x-4">
            <dt className="text-muted-foreground">Tipo</dt>
            <dd>
              {entry.categoryName
                ? `${KIND_LABEL[entry.kind]} · ${entry.categoryName}`
                : KIND_LABEL[entry.kind]}
            </dd>
            <dt className="text-muted-foreground">Meio</dt>
            <dd>{PAYMENT_METHOD_LABEL[entry.paymentMethod]}</dd>
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
                <dt className="text-muted-foreground">{isPayment ? 'Previsto' : 'Estimado'}</dt>
                <dd>{formatBRL(entry.estimatedAmountCents)}</dd>
              </>
            )}
            {adjustment && adjustment.discountCents > 0 && (
              <>
                <dt className="text-muted-foreground">Desconto</dt>
                <dd data-testid="entry-discount" className="text-income">
                  {formatBRL(adjustment.discountCents)}
                </dd>
              </>
            )}
            {adjustment && adjustment.surchargeCents > 0 && (
              <>
                <dt className="text-muted-foreground">Acréscimo</dt>
                <dd data-testid="entry-surcharge">{formatBRL(adjustment.surchargeCents)}</dd>
              </>
            )}
            {link?.role === 'payment' && (
              <>
                <dt className="text-muted-foreground">Conta paga</dt>
                <dd>
                  <Link
                    href={`/lancamentos/${link.other.id}`}
                    data-testid="anticipation-link"
                    className="text-primary hover:underline"
                  >
                    vencia em {link.other.dueDate ? formatDateBR(link.other.dueDate) : '—'} · ver conta
                    original
                  </Link>
                </dd>
              </>
            )}
            {link?.role === 'original' && (
              <>
                <dt className="text-muted-foreground">Paga antes</dt>
                <dd>
                  <Link
                    href={`/lancamentos/${link.other.id}`}
                    data-testid="anticipation-link"
                    className="text-primary hover:underline"
                  >
                    {link.other.postedDate ? formatDateBR(link.other.postedDate) : ''} ·{' '}
                    {formatBRL(link.other.amountCents)} · ver pagamento
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    Fica de registro: não entra nas somas de{' '}
                    {entry.dueDate ? formatDateBR(entry.dueDate) : 'seu mês'}.
                  </span>
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Lançado</dt>
            <dd>
              por {entry.createdByName} {SOURCE_LABEL[entry.source] ?? ''}
            </dd>
            <dt className="text-muted-foreground">De quem é</dt>
            <dd>{entry.beneficiaryName ?? 'Casal'}</dd>
            {entry.notes && (
              <>
                <dt className="text-muted-foreground">Observações</dt>
                <dd className="whitespace-pre-line">{entry.notes}</dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* a ação principal à vista; editar abre o formulário num painel (o detalhe é só leitura) */}
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        {pending && (
          <ConfirmPaymentDialog
            id={entry.id}
            version={entry.version}
            description={entry.description}
            income={income}
            amountText={formatDecimalBR(entry.amountCents)}
            today={hoje}
            wallets={wallets}
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
        {isPayment && editable && (
          <ActionButton
            action={revertPaymentAction}
            fields={fields}
            label="Estornar pagamento"
            confirm={{
              title: 'Estornar o pagamento antecipado?',
              description: `O pagamento sai do saldo e a conta original volta para "a pagar"${
                link?.role === 'payment' && link.other.dueDate
                  ? `, vencendo em ${formatDateBR(link.other.dueDate)}`
                  : ''
              }.`,
              confirmLabel: 'Estornar',
            }}
          />
        )}
        {editable && (
          <SheetAction label="Editar" title="Editar lançamento" icon={<Pencil aria-hidden />}>
            <EntryForm
              key={entry.version} // depois de uma baixa o formulário recomeça com os valores novos, não os de antes
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
          </SheetAction>
        )}
      </div>
    </div>
  );
}
