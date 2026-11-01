import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { UploadStatementForm } from '@/components/imports/import-forms';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listCardSummaries } from '@/db/queries/cards';
import { listCardImports } from '@/db/queries/imports';
import { formatMonthLabel, today, toMonthParam } from '@/domain/dates';

export const metadata: Metadata = { title: 'Importar fatura' };

export default async function ImportPage({ params }: PageProps<'/cartoes/[id]/importar'>) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const [[s], imports] = await Promise.all([
    listCardSummaries(db, today(), { cardId: id }),
    listCardImports(db, id),
  ]);
  if (!s) notFound();
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/cartoes/${id}`}>
          <ArrowLeft aria-hidden /> {s.card.name}
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Importar fatura (OFX ou CSV)</CardTitle>
          <CardDescription>
            O app compara cada linha com o que já está lançado e mostra tudo para você revisar. Nada entra sem
            a sua confirmação. Pode importar a mesma fatura de novo mais tarde: só as linhas novas entram.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadStatementForm cardId={id} currentMonth={toMonthParam(today())} />
        </CardContent>
      </Card>
      {imports.length > 0 && (
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-3">
            <CardTitle>Importações anteriores</CardTitle>
          </CardHeader>
          <CardContent className="divide-y border-t px-0">
            {imports.map((i) => (
              <Link
                key={i.id}
                href={`/importacoes/${i.id}`}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{i.fileName}</div>
                  <div className="text-xs text-muted-foreground first-letter:uppercase">
                    fatura de {formatMonthLabel(i.referenceMonth)}
                  </div>
                </div>
                {i.pending > 0 ? (
                  <Badge variant="outline">{i.pending} a revisar</Badge>
                ) : (
                  <Badge variant="secondary">concluída</Badge>
                )}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
