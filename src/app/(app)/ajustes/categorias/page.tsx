import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { CategoryRow, CreateCategoryForm } from '@/components/settings/category-forms';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listManagedCategories } from '@/db/queries/lookups';
import { isProtectedCategory } from '@/domain/categories';

export const metadata: Metadata = { title: 'Categorias' };
export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const all = await listManagedCategories(getDb());
  const groups = [
    { kind: 'EXPENSE' as const, title: 'Despesas' },
    { kind: 'INCOME' as const, title: 'Receitas' },
  ];
  const archived = all.filter((c) => c.archived);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/ajustes">
          <ArrowLeft aria-hidden /> Ajustes
        </Link>
      </Button>
      <h1 className="text-2xl font-semibold tracking-tight">Categorias</h1>

      <Card>
        <CardHeader>
          <CardTitle>Nova categoria</CardTitle>
          <CardDescription>
            Aparece na hora nos lançamentos, nos fixos, na importação e no bot (pelos apelidos).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateCategoryForm />
        </CardContent>
      </Card>

      {groups.map((g) => {
        const rows = all.filter((c) => c.kind === g.kind && !c.archived);
        return (
          <Card key={g.kind} className="gap-0 pb-0">
            <CardHeader className="pb-3">
              <CardTitle>{g.title}</CardTitle>
              <CardDescription>{rows.length} ativas</CardDescription>
            </CardHeader>
            <CardContent className="border-t px-0">
              {rows.map((c) => (
                <CategoryRow key={c.id} c={c} isProtected={isProtectedCategory(c.kind, c.name)} />
              ))}
            </CardContent>
          </Card>
        );
      })}

      {archived.length > 0 && (
        <Card className="gap-0 pb-0">
          <CardHeader className="pb-3">
            <CardTitle>Arquivadas</CardTitle>
            <CardDescription>
              Não aparecem nas listas de escolha, mas os lançamentos antigos e os relatórios continuam com
              elas.
            </CardDescription>
          </CardHeader>
          <CardContent className="border-t px-0">
            {archived.map((c) => (
              <CategoryRow key={c.id} c={c} isProtected={false} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
