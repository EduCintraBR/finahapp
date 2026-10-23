import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { LoanSummaryCard } from '@/components/loans/loan-summary';
import { Button } from '@/components/ui/button';
import { getDb } from '@/db/client';
import { listLoans } from '@/db/queries/loans';
import { today } from '@/domain/dates';

export const metadata: Metadata = { title: 'Empréstimos' };
export const dynamic = 'force-dynamic';

export default async function LoansPage() {
  const loans = await listLoans(getDb(), today());
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Empréstimos</h1>
        <Button asChild size="sm">
          <Link href="/emprestimos/novo">
            <Plus aria-hidden /> Novo
          </Link>
        </Button>
      </div>
      {loans.length === 0 ? (
        <div className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhum empréstimo cadastrado. Informe o valor que recebeu e o total a pagar (com juros): o app
          divide em parcelas, mostra o que falta e calcula o desconto quando você adianta.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {loans.map((l) => (
            <LoanSummaryCard key={l.id} l={l} href={`/emprestimos/${l.id}`} />
          ))}
        </div>
      )}
    </div>
  );
}
