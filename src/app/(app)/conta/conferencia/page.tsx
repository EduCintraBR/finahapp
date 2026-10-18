import type { Metadata } from 'next';
import Link from 'next/link';
import { Amount } from '@/components/money/amount';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listCheckpoints } from '@/db/queries/entries';
import { formatDateBR, today } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { CheckpointForm } from './checkpoint-form';

export const metadata: Metadata = { title: 'Conferir saldo' };

export default async function CheckpointPage() {
  const history = await listCheckpoints(getDb());
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Conferir saldo</h1>
      <Card>
        <CardHeader>
          <CardDescription>
            Abra o app do banco, veja o saldo e informe aqui. Se não bater, o Finah mostra a diferença.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CheckpointForm today={today()} />
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-3">
            <CardTitle>Conferências anteriores</CardTitle>
          </CardHeader>
          <CardContent className="divide-y border-t px-0">
            {history.map((h) => {
              const diff = h.statementCents - h.computedCents;
              return (
                <div key={h.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{formatDateBR(h.date)}</div>
                    <div className="text-xs text-muted-foreground">
                      por {h.createdByName} ·{' '}
                      {diff === 0 ? (
                        'bateu'
                      ) : h.adjustmentTransactionId ? (
                        <Link
                          href={`/lancamentos/${h.adjustmentTransactionId}`}
                          className="text-primary hover:underline"
                        >
                          ajuste de {formatBRL(diff)}
                        </Link>
                      ) : (
                        `diferença de ${formatBRL(diff)} sem ajuste`
                      )}
                    </div>
                  </div>
                  <Amount cents={h.statementCents} className="font-medium" />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
