import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { LoanForm } from '@/components/loans/loan-forms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { addMonths, today } from '@/domain/dates';

export const metadata: Metadata = { title: 'Novo empréstimo' };
export const dynamic = 'force-dynamic';

export default function NewLoanPage() {
  const hoje = today();
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/emprestimos">
          <ArrowLeft aria-hidden /> Empréstimos
        </Link>
      </Button>
      <Card>
        <CardHeader>
          <CardTitle>Novo empréstimo</CardTitle>
          <CardDescription>
            Você informa o que recebeu e o total a pagar já com juros. O app divide em parcelas mensais.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoanForm today={hoje} defaultFirstDue={addMonths(hoje, 1)} />
        </CardContent>
      </Card>
    </div>
  );
}
