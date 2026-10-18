import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { UploadAccountStatementForm } from '@/components/imports/account-import-forms';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listBankImports } from '@/db/queries/imports';
import { formatDateBR } from '@/domain/dates';

export const metadata: Metadata = { title: 'Importar extrato' };
export const dynamic = 'force-dynamic';

export default async function ImportAccountPage() {
  const imports = await listBankImports(getDb());
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/lancamentos">
          <ArrowLeft aria-hidden /> Lançamentos
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Importar extrato da conta (OFX ou CSV)</CardTitle>
          <CardDescription>
            O app compara cada linha com o que já está lançado (inclusive contas pendentes, que recebem a
            baixa) e mostra tudo para você revisar. Nada entra sem a sua confirmação.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadAccountStatementForm />
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
                  {i.periodStart && i.periodEnd && (
                    <div className="text-xs text-muted-foreground">
                      {formatDateBR(i.periodStart)} a {formatDateBR(i.periodEnd)}
                    </div>
                  )}
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
