import Link from 'next/link';
import { ArrowLeft, CheckCircle2, TriangleAlert } from 'lucide-react';
import { AccountBatchActions, AccountLineActions } from '@/components/imports/account-import-forms';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { getAccountImportReview } from '@/db/queries/imports';
import type { CategoryOption, UserOption } from '@/db/queries/lookups';
import { formatDateBR } from '@/domain/dates';
import { formatBRL } from '@/domain/money';

type Review = NonNullable<Awaited<ReturnType<typeof getAccountImportReview>>>;
type Line = Review['lines'][number];

const KIND: Record<Line['payload']['suggestedKind'], string> = {
  EXPENSE: 'Despesa',
  INCOME: 'Receita',
  TRANSFER: 'Transferência',
  INVOICE_PAYMENT: 'Pagamento de fatura',
};
const STATUS: Record<string, string> = { MATCHED: 'Conciliada', CREATED: 'Criada', IGNORED: 'Ignorada' };

/** Revisão do extrato da conta (D45–D47). */
export function AccountReview({
  r,
  categories,
  users,
}: {
  r: Review;
  categories: CategoryOption[];
  users: UserOption[];
}) {
  const pending = r.lines.filter((l) => l.status === 'PENDING_REVIEW');
  const done = r.lines.filter((l) => l.status !== 'PENDING_REVIEW');
  const suggested = pending.filter((l) => l.suggestion).length;
  const fresh = pending.filter((l) => !l.suggestion && l.payload.suggestedKind !== 'INVOICE_PAYMENT').length;
  const diff =
    r.fileBalanceCents === null || r.appBalanceCents === null ? null : r.appBalanceCents - r.fileBalanceCents;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/lancamentos/importar">
          <ArrowLeft aria-hidden /> Importações
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardDescription>Conta principal · {r.batch.fileName}</CardDescription>
          <CardTitle>Extrato da conta</CardTitle>
          <CardDescription>
            {r.batch.periodStart && r.batch.periodEnd && (
              <>
                Período {formatDateBR(r.batch.periodStart)} a {formatDateBR(r.batch.periodEnd)} ·{' '}
              </>
            )}
            {r.lines.length} linhas · {pending.length} a revisar
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {diff !== null && (
            <div
              className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${diff === 0 ? 'bg-income/10' : 'bg-amber-500/10'}`}
            >
              {diff === 0 ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-income" aria-hidden />
              ) : (
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
              )}
              <span>
                Saldo em {formatDateBR(r.batch.periodEnd!)} no app:{' '}
                <span className="font-medium">{formatBRL(r.appBalanceCents!)}</span> · no arquivo:{' '}
                <span className="font-medium">{formatBRL(r.fileBalanceCents!)}</span>
                {diff === 0
                  ? ' — bate centavo a centavo.'
                  : ` — diferença de ${formatBRL(diff)}${pending.length ? ' (revise as linhas pendentes)' : ' (confira o saldo inicial em Ajustes)'}.`}
              </span>
            </div>
          )}
          {pending.length > 0 && (
            <AccountBatchActions batchId={r.batch.id} suggested={suggested} fresh={fresh} />
          )}
          <Link href="/lancamentos" className="inline-block text-sm text-primary hover:underline">
            Ver os lançamentos →
          </Link>
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">A revisar</h2>
          {pending.map((l) => (
            <Card key={l.id} className="gap-3 py-4" data-testid="account-line">
              <CardContent className="space-y-3 px-4">
                <LineHeader l={l} />
                <AccountLineActions
                  line={{
                    id: l.id,
                    direction: l.payload.direction,
                    description: l.payload.description,
                    suggestedKind: l.payload.suggestedKind,
                    suggestedCategoryId: l.payload.suggestedCategoryId,
                    suggestion: l.suggestion
                      ? { label: l.suggestion.label, pending: l.suggestion.pending }
                      : null,
                  }}
                  categories={categories}
                  users={users}
                  invoices={r.invoiceOptions}
                />
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {done.length > 0 && (
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-3">
            <CardTitle>Revisadas</CardTitle>
          </CardHeader>
          <CardContent className="divide-y border-t px-0">
            {done.map((l) => (
              <div key={l.id} className="space-y-1 px-4 py-3">
                <LineHeader l={l} />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={l.status === 'IGNORED' ? 'outline' : 'secondary'}>{STATUS[l.status]}</Badge>
                  {l.result && (
                    <Link href={l.result.href} className="truncate text-primary hover:underline">
                      {l.result.label}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LineHeader({ l }: { l: Line }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{l.memo}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{formatDateBR(l.date)}</span>
          <Badge variant="outline">{KIND[l.payload.suggestedKind]}</Badge>
        </div>
      </div>
      <Amount
        cents={l.payload.amountCents}
        direction={l.payload.direction === 'IN' ? 'in' : 'out'}
        className="text-sm font-medium"
      />
    </div>
  );
}
