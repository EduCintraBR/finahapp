import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ChevronRight, CreditCard, Repeat } from 'lucide-react';
import { EntryList } from '@/components/entries/entry-list';
import { monthSuffix } from '@/components/layout/month-link';
import { Amount } from '@/components/money/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getDb } from '@/db/client';
import { SUMMARY_KINDS, summaryDetail, type SummaryKind } from '@/db/queries/summary-detail';
import { formatDateBR, formatMonthLabel, monthStart, today, toMonthParam } from '@/domain/dates';
import { resolveMonth } from '@/lib/month';
import { ensureOccurrences } from '@/server/ensure-occurrences';

export const metadata: Metadata = { title: 'Detalhe do mês' };

const TITLE: Record<SummaryKind, string> = {
  entrou: 'Entrou',
  saiu: 'Saiu',
  'a-receber': 'A receber',
  'a-pagar': 'A pagar',
};

const EMPTY: Record<SummaryKind, string> = {
  entrou: 'Nenhuma receita recebida neste mês.',
  saiu: 'Nenhuma saída paga neste mês.',
  'a-receber': 'Nada a receber neste mês.',
  'a-pagar': 'Nada a pagar neste mês.',
};

const isKind = (v: string): v is SummaryKind => (SUMMARY_KINDS as readonly string[]).includes(v);

export default async function SummaryDetailPage({ params, searchParams }: PageProps<'/resumo/[tipo]'>) {
  await ensureOccurrences();
  const { tipo } = await params;
  if (!isKind(tipo)) notFound();
  const hoje = today();
  const month = await resolveMonth(searchParams);
  const suffix = monthSuffix(month, monthStart(hoje));
  const future = month > monthStart(hoje);
  const d = await summaryDetail(getDb(), tipo, month, hoje);
  const empty = d.entries.length + d.invoices.length + d.projected.length === 0;
  const direction = tipo === 'entrou' || tipo === 'a-receber' ? 'in' : 'out';
  const label = formatMonthLabel(month);

  const about: Record<SummaryKind, string> = {
    entrou:
      'Receitas já recebidas no mês, até hoje. O dinheiro de empréstimo e as receitas agendadas não entram aqui.',
    saiu: 'Despesas, pagamentos de fatura e antecipações já pagos no mês, até hoje.',
    'a-receber': `Receitas pendentes e agendadas do mês${future ? ', mais as receitas previstas dos seus fixos' : ''}.`,
    'a-pagar': `Contas pendentes e agendadas, e o que falta pagar de cada fatura que vence no mês${future ? ', mais o que os fixos vão gerar' : ''}.`,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/${suffix}`}>
          <ArrowLeft aria-hidden /> Início
        </Link>
      </Button>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {TITLE[tipo]} · <span className="first-letter:uppercase">{label}</span>
        </h1>
        <Amount
          cents={d.totalCents}
          direction={d.totalCents > 0 ? direction : undefined}
          className="text-3xl font-semibold"
          data-testid="detail-total"
        />
        <p className="text-sm text-muted-foreground">{about[tipo]}</p>
      </div>

      {empty && (
        <p className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {EMPTY[tipo]}
        </p>
      )}

      {d.entries.length > 0 && (
        <section aria-label="Lançamentos" className="space-y-2">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">Lançamentos</h2>
          <EntryList entries={d.entries} today={hoje} returnTo={`/resumo/${tipo}${suffix}`} />
        </section>
      )}

      {d.invoices.length > 0 && (
        <section aria-label="Faturas" className="space-y-2">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">Faturas</h2>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {d.invoices.map((i) => (
              <Link
                key={i.invoiceId}
                href={`/cartoes/faturas/${i.invoiceId}`}
                data-testid="invoice-line"
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-warning/20 text-warning-text">
                  <CreditCard className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">Fatura {i.cardName}</div>
                  <div className="text-xs text-muted-foreground">
                    vence {formatDateBR(i.dueDate)} · {i.closed ? 'fechada' : 'aberta'} · falta pagar
                  </div>
                </div>
                <Amount cents={i.remainingCents} className="font-medium" />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      )}

      {d.projected.length > 0 && (
        <section aria-label="Previstos pelos fixos" className="space-y-2">
          <h2 className="px-1 text-sm font-medium text-muted-foreground">Previstos pelos seus fixos</h2>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {d.projected.map((p) => (
              <Link
                key={`${p.templateId}-${p.dueDate}`}
                href={`/fixos/${p.templateId}`}
                data-testid="projected-line"
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Repeat className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.description}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {p.subscription ? 'cobrança' : 'vence'} {formatDateBR(p.dueDate)}
                    <Badge variant="outline">Previsto</Badge>
                    {p.subscription && <Badge variant="outline">no cartão</Badge>}
                  </div>
                </div>
                <Amount cents={p.amountCents} className="font-medium" />
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      )}

      {(tipo === 'entrou' || tipo === 'saiu') && (
        <Button asChild variant="outline" size="sm">
          <Link
            href={`/lancamentos?mes=${toMonthParam(month)}&tipo=${tipo === 'entrou' ? 'INCOME' : 'EXPENSE'}`}
          >
            Ver em Lançamentos
          </Link>
        </Button>
      )}
    </div>
  );
}
