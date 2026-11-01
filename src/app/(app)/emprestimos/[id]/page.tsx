import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ActionButton } from '@/components/forms/action-button';
import { PayLoanSheet } from '@/components/loans/loan-forms';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { getLoan } from '@/db/queries/loans';
import { formatDateBR, today } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { cn } from '@/lib/utils';
import { deleteLoanAction } from '../actions';

export const metadata: Metadata = { title: 'Empréstimo' };
export const dynamic = 'force-dynamic';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default async function LoanPage({ params }: PageProps<'/emprestimos/[id]'>) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const hoje = today();
  const loan = await getLoan(getDb(), id, hoje);
  if (!loan) notFound();
  const s = loan.summary;
  const pending = loan.installments.filter((i) => i.paidCents === null);
  const canDelete = s.paidCount === 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/emprestimos">
          <ArrowLeft aria-hidden /> Empréstimos
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            {s.settled ? (
              <Badge variant="outline">Quitado</Badge>
            ) : s.overdueCount > 0 ? (
              <Badge variant="destructive">
                {plural(s.overdueCount, 'parcela atrasada', 'parcelas atrasadas')}
              </Badge>
            ) : (
              <Badge variant="secondary">Em andamento</Badge>
            )}
            {loan.lender && <Badge variant="outline">{loan.lender}</Badge>}
          </div>
          <CardTitle className="text-xl">{loan.name}</CardTitle>
          <div className="text-xs text-muted-foreground">Falta pagar</div>
          <Amount cents={s.remainingCents} className="text-3xl font-semibold" data-testid="loan-remaining" />
          <CardDescription>
            {s.paidCount} de {loan.installmentCount} parcelas pagas
            {s.nextDueDate ? ` · próxima em ${formatDateBR(s.nextDueDate)}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Stat label="Recebido" cents={loan.principalCents} />
          <Stat label="Total a pagar" cents={loan.totalCents} />
          <Stat label="Juros embutidos" cents={loan.interestCents} />
          <Stat label="Já pago" cents={s.paidCents} testId="loan-paid" />
          <Stat label="Economia com desconto" cents={s.savingsCents} tone="in" testId="loan-savings" />
          {s.lateFeesCents > 0 && <Stat label="Acréscimo por atraso" cents={s.lateFeesCents} tone="out" />}
        </CardContent>
      </Card>

      {!s.settled && (
        <PayLoanSheet
          loanId={loan.id}
          today={hoje}
          total={loan.installmentCount}
          pending={pending.map((p) => ({
            id: p.id,
            number: p.number,
            dueDate: p.dueDate,
            scheduledCents: p.scheduledCents,
          }))}
        />
      )}

      <Card className="gap-0 pb-0">
        <CardHeader className="pb-3">
          <CardTitle>Parcelas</CardTitle>
          <CardDescription>
            Cada parcela também aparece em Lançamentos e na Home quando chega o mês.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y border-t px-0">
          {loan.installments.map((i) => {
            const paid = i.paidCents !== null;
            const diff = paid ? i.scheduledCents - i.paidCents! : 0;
            return (
              <div
                key={i.id}
                className="flex items-center gap-3 px-4 py-3 text-sm"
                data-testid="loan-installment"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {i.number}/{loan.installmentCount}
                    {i.overdue && <span className="ml-2 text-xs text-destructive">atrasada</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {paid ? (
                      <>
                        Pago em {formatDateBR(i.paidDate!)} · venc. {formatDateBR(i.dueDate)}
                        {i.daysEarly !== null &&
                          i.daysEarly > 0 &&
                          ` · adiantou ${plural(i.daysEarly, 'dia', 'dias')}`}
                        {i.daysEarly !== null &&
                          i.daysEarly < 0 &&
                          ` · atrasou ${plural(-i.daysEarly, 'dia', 'dias')}`}
                      </>
                    ) : (
                      <>Vence {formatDateBR(i.dueDate)}</>
                    )}
                  </div>
                  {paid && diff !== 0 && (
                    <div className={cn('text-xs', diff > 0 ? 'text-income' : 'text-expense')}>
                      {diff > 0 ? `desconto de ${formatBRL(diff)}` : `acréscimo de ${formatBRL(-diff)}`}{' '}
                      (programado {formatBRL(i.scheduledCents)})
                    </div>
                  )}
                </div>
                <Amount
                  cents={paid ? i.paidCents! : i.scheduledCents}
                  className={cn('font-medium', !paid && 'text-muted-foreground')}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {loan.notes && (
        <Card>
          <CardContent className="text-sm whitespace-pre-line text-muted-foreground">
            {loan.notes}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Excluir</CardTitle>
          <CardDescription>
            {canDelete
              ? 'Tira o valor recebido do saldo e apaga as parcelas. Só dá enquanto nenhuma parcela foi paga.'
              : 'Já tem parcela paga, então não dá mais para excluir. Para desfazer um pagamento, volte a parcela para pendente em Lançamentos.'}
          </CardDescription>
        </CardHeader>
        {canDelete && (
          <CardContent>
            <ActionButton
              action={deleteLoanAction}
              fields={{ id: loan.id }}
              variant="destructive"
              label="Excluir empréstimo"
              pendingLabel="Excluindo…"
              confirm={{
                title: 'Excluir este empréstimo?',
                description:
                  'O valor recebido sai do saldo da conta e as parcelas somem. Fica registrado no histórico de alterações.',
                confirmLabel: 'Excluir',
              }}
            />
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function Stat({
  label,
  cents,
  tone,
  testId,
}: {
  label: string;
  cents: number;
  tone?: 'in' | 'out';
  testId?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <Amount
        cents={cents}
        direction={cents > 0 ? tone : undefined}
        className="font-medium"
        data-testid={testId}
      />
    </div>
  );
}
