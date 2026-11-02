import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import {
  aliasesLabel,
  CategoryLinkRow,
  CategorySection,
  CategoryTabs,
  usageLabel,
} from '@/components/categories/category-list';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { getDb } from '@/db/client';
import { listManagedCategories } from '@/db/queries/lookups';

export const metadata: Metadata = { title: 'Categorias' };

/** Menu Categorias, aba Categorias (D77): só as de topo; as subcategorias têm a aba delas. */
export default async function CategoriesPage() {
  const all = await listManagedCategories(getDb());
  const tops = all.filter((c) => c.parentId === null);
  const subCount = (id: string) => all.filter((s) => s.parentId === id && !s.archived).length;
  const row = (c: (typeof all)[number]) => {
    const n = subCount(c.id);
    return (
      <CategoryLinkRow
        key={c.id}
        c={c}
        href={`/categorias/${c.id}`}
        icon={c.icon}
        details={[
          n > 0 && `${n} ${n === 1 ? 'subcategoria' : 'subcategorias'}`,
          usageLabel(c.usageCount),
          aliasesLabel(c.botAliases),
        ]}
      />
    );
  };
  const archived = tops.filter((c) => c.archived);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Categorias"
        actions={
          <Button asChild size="sm">
            <Link href="/categorias/nova">
              <Plus aria-hidden /> Nova
            </Link>
          </Button>
        }
      />
      <CategoryTabs active="categorias" />
      <CategorySection title="Despesas">
        {tops.filter((c) => c.kind === 'EXPENSE' && !c.archived).map(row)}
      </CategorySection>
      <CategorySection title="Receitas">
        {tops.filter((c) => c.kind === 'INCOME' && !c.archived).map(row)}
      </CategorySection>
      {archived.length > 0 && (
        <CategorySection
          title="Arquivadas"
          description="Não aparecem nas listas de escolha, mas os lançamentos antigos e os relatórios continuam com elas."
        >
          {archived.map(row)}
        </CategorySection>
      )}
    </div>
  );
}
