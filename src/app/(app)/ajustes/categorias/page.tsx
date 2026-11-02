import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { CategoryRow, CreateCategoryForm, type ParentOption } from '@/components/settings/category-forms';
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
  const nameOf = new Map(all.map((c) => [c.id, c.name]));
  /** categorias de topo ativas: podem receber subcategorias */
  const parents: ParentOption[] = all
    .filter((c) => !c.archived && c.parentId === null)
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
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
            Aparece na hora nos lançamentos, nos fixos, na importação e no bot (pelos apelidos). Para uma
            subcategoria (ex.: Hortifruti dentro de Mercado), escolha a categoria em &ldquo;Dentro de&rdquo;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateCategoryForm parents={parents} />
        </CardContent>
      </Card>

      {groups.map((g) => {
        // mães ativas, cada uma seguida das suas subcategorias ativas
        const tops = all.filter((c) => c.kind === g.kind && !c.archived && c.parentId === null);
        const subsOf = (id: string) => all.filter((c) => c.parentId === id && !c.archived);
        const rows = tops.flatMap((c) => [c, ...subsOf(c.id)]);
        return (
          <Card key={g.kind} className="gap-0 pb-0">
            <CardHeader className="pb-3">
              <CardTitle>{g.title}</CardTitle>
              <CardDescription>
                {rows.length} {rows.length === 1 ? 'ativa' : 'ativas'}
              </CardDescription>
            </CardHeader>
            <CardContent className="border-t px-0">
              {rows.map((c) => (
                <CategoryRow
                  key={c.id}
                  c={c}
                  isProtected={isProtectedCategory(c.kind, c.name)}
                  parents={parents}
                  parentName={c.parentId ? (nameOf.get(c.parentId) ?? null) : null}
                  childCount={subsOf(c.id).length}
                />
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
              <CategoryRow
                key={c.id}
                c={c}
                isProtected={false}
                parents={parents}
                parentName={c.parentId ? (nameOf.get(c.parentId) ?? null) : null}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
