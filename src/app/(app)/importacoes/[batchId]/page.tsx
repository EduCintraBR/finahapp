import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CheckCircle2, TriangleAlert } from 'lucide-react';
import { AccountReview } from '@/components/imports/account-review';
import { BatchActions, PendingLineActions, type LineView } from '@/components/imports/import-forms';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { getPrimaryAccount } from '@/db/queries/accounts';
import { batchKind, getAccountImportReview, getBatchCandidates, getImportReview } from '@/db/queries/imports';
import { BulkIgnoreBar, LineCheckbox, RefreshSuggestionsButton } from '@/components/imports/batch-tools';
import { listCategories, listUsers } from '@/db/queries/lookups';
import { addMonths, formatDateBR, formatMonthLabel } from '@/domain/dates';
import { formatBRL } from '@/domain/money';

export const metadata: Metadata = { title: 'Revisar importação' };

const KIND: Record<LineView['kind'], string> = {
  PURCHASE: 'Compra',
  INSTALLMENT: 'Parcela',
  PAYMENT: 'Pagamento',
  CREDIT: 'Crédito',
};
const STATUS: Record<string, string> = { MATCHED: 'Conciliada', CREATED: 'Criada', IGNORED: 'Ignorada' };

export default async function ImportReviewPage({ params }: PageProps<'/importacoes/[batchId]'>) {
  const { batchId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) notFound();
  const db = getDb();
  if ((await batchKind(db, batchId)) === 'BANK_STATEMENT') {
    const [ar, cats, people] = await Promise.all([
      getAccountImportReview(db, batchId),
      listCategories(db),
      listUsers(db),
    ]);
    if (!ar) notFound();
    return (
      <AccountReview
        r={ar}
        categories={cats}
        users={people}
        candidates={await getBatchCandidates(db, batchId)}
      />
    );
  }
  const [r, categories, users, candidates, account] = await Promise.all([
    getImportReview(db, batchId),
    listCategories(db),
    listUsers(db),
    getBatchCandidates(db, batchId),
    getPrimaryAccount(db),
  ]);
  if (!r) notFound();
  const opening = account?.openingBalanceDate ?? null;

  const fallback = categories.find((c) => c.name === 'A classificar' && c.kind === 'EXPENSE')!;
  const pending = r.lines.filter((l) => l.status === 'PENDING_REVIEW');
  const done = r.lines.filter((l) => l.status !== 'PENDING_REVIEW');
  const suggested = pending.filter((l) => l.suggestion).length;
  const fresh = pending.filter((l) => !l.suggestion && l.payload.kind !== 'CREDIT').length;
  const monthLabel = formatMonthLabel(r.invoice.referenceMonth);
  const diff = r.fileRemainingCents === null ? null : r.appRemainingCents - r.fileRemainingCents;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/cartoes/${r.card.id}/importar`}>
          <ArrowLeft aria-hidden /> Importações
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardDescription>
            {r.card.name} · {r.batch.fileName}
          </CardDescription>
          <CardTitle className="first-letter:uppercase">Fatura de {monthLabel}</CardTitle>
          <CardDescription>
            Período {formatDateBR(r.batch.periodStart!)} a {formatDateBR(r.batch.periodEnd!)} ·{' '}
            {r.lines.length} linhas · {pending.length} a revisar
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {diff !== null && (
            <div
              className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${diff === 0 ? 'bg-income/10' : 'bg-warning/10'}`}
            >
              {diff === 0 ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-income" aria-hidden />
              ) : (
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
              )}
              <span>
                A pagar no app: <span className="font-medium">{formatBRL(r.appRemainingCents)}</span> · no
                arquivo: <span className="font-medium">{formatBRL(r.fileRemainingCents!)}</span>
                {diff === 0
                  ? ' — bate centavo a centavo.'
                  : ` — diferença de ${formatBRL(diff)}${pending.length ? ' (revise as linhas pendentes)' : ''}.`}
              </span>
            </div>
          )}
          {pending.length > 0 && <BatchActions batchId={batchId} suggested={suggested} fresh={fresh} />}
          {pending.length > 0 && (
            <BulkIgnoreBar batchId={batchId} pending={pending.length} additionalCard={r.card.isAdditional} />
          )}
          {pending.length > 0 && <RefreshSuggestionsButton batchId={batchId} kind="CARD_STATEMENT" />}
          <Link
            href={`/cartoes/faturas/${r.invoice.id}`}
            className="inline-block text-sm text-primary hover:underline"
          >
            Ver a fatura no app →
          </Link>
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">A revisar</h2>
          {pending.map((l) => (
            <Card key={l.id} className="gap-3 py-4">
              <CardContent className="flex gap-3 px-4">
                <LineCheckbox lineId={l.id} />
                <div className="min-w-0 flex-1 space-y-3">
                  <LineHeader l={l} />
                  <PendingLineActions
                    line={{
                      id: l.id,
                      kind: l.payload.kind,
                      description: l.payload.description,
                      amountCents: l.payload.amountCents,
                      installment: l.payload.installment,
                      suggestedCategoryId: l.payload.suggestedCategoryId,
                      paysThisInvoice: l.payload.paysThisInvoice,
                      suggestion: l.suggestion
                        ? { label: l.suggestion.label, date: l.suggestion.date }
                        : null,
                      candidates: (candidates[l.id] ?? []).filter((c) => c.id !== l.suggestionId),
                      blockedBefore:
                        opening &&
                        l.date < opening &&
                        (l.payload.kind === 'PURCHASE' ||
                          (l.payload.kind === 'INSTALLMENT' && l.payload.installment?.k === 1))
                          ? opening
                          : null,
                    }}
                    categories={categories}
                    users={users}
                    fallbackCategoryId={fallback.id}
                    invoiceLabels={{
                      this: `Fatura de ${monthLabel}`,
                      previous: `Fatura de ${formatMonthLabel(addMonths(r.invoice.referenceMonth, -1))}`,
                    }}
                  />
                </div>
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

function LineHeader({ l }: { l: NonNullable<Awaited<ReturnType<typeof getImportReview>>>['lines'][number] }) {
  const p = l.payload;
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{l.memo}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{formatDateBR(l.date)}</span>
          <Badge variant="outline">
            {KIND[p.kind]}
            {p.installment && ` ${p.installment.k}/${p.installment.n}`}
          </Badge>
        </div>
      </div>
      <Amount
        cents={p.amountCents}
        direction={p.kind === 'PAYMENT' || p.kind === 'CREDIT' ? 'in' : undefined}
        className="text-sm font-medium"
      />
    </div>
  );
}
