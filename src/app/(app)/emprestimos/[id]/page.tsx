import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Ellipsis } from 'lucide-react';
import { ActionButton } from '@/components/forms/action-button';
import { PageHeader } from '@/components/layout/page-header';
import { LoanInstallments } from '@/components/loans/loan-forms';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SheetAction } from '@/components/ui/sheet-action';
import { getDb } from '@/db/client';
import { getLoan } from '@/db/queries/loans';
import { formatDateBR, today } from '@/domain/dates';
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
  const canDelete = s.paidCount === 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={loan.name}
        back={{ href: '/emprestimos', label: 'Empréstimos' }}
        actions={
          <SheetAction
            label="Mais ações"
            description={loan.name}
            iconOnly
            variant="ghost"
            icon={<Ellipsis aria-hidden />}
          >
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {canDelete
                  ? 'Excluir tira o valor recebido do saldo e apaga as parcelas. Só dá enquanto nenhuma parcela foi paga.'
                  : 'Já tem parcela paga, então não dá mais para excluir. Para desfazer um pagamento, volte a parcela para pendente em Lançamentos.'}
              </p>
              {canDelete && (
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
              )}
            </div>
          </SheetAction>
        }
      />

      <Card className="gap-3 py-4">
        <CardContent className="space-y-3 px-4 sm:px-6">
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
          <div>
            <div className="text-xs text-muted-foreground">Falta pagar</div>
            <Amount
              cents={s.remainingCents}
              className="block text-3xl font-semibold tracking-tight"
              data-testid="loan-remaining"
            />
            <p className="text-sm text-muted-foreground">
              {s.paidCount} de {loan.installmentCount} parcelas pagas
              {s.nextDueDate ? ` · próxima em ${formatDateBR(s.nextDueDate)}` : ''}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-sm">
            <Stat label="Recebido" cents={loan.principalCents} />
            <Stat label="Total a pagar" cents={loan.totalCents} />
            <Stat label="Juros embutidos" cents={loan.interestCents} />
            <Stat label="Já pago" cents={s.paidCents} testId="loan-paid" />
            <Stat label="Economia com desconto" cents={s.savingsCents} tone="in" testId="loan-savings" />
            {s.lateFeesCents > 0 && <Stat label="Acréscimo por atraso" cents={s.lateFeesCents} tone="out" />}
          </div>
        </CardContent>
      </Card>

      {/* uma lista só: as pagas e as pendentes, que você marca e paga com o botão que fica à vista */}
      <LoanInstallments
        loanId={loan.id}
        installments={loan.installments}
        total={loan.installmentCount}
        today={hoje}
      />

      {loan.notes && (
        <Card>
          <CardContent className="text-sm whitespace-pre-line text-muted-foreground">
            {loan.notes}
          </CardContent>
        </Card>
      )}
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
