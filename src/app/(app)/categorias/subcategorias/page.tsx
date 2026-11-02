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

export const metadata: Metadata = { title: 'Subcategorias' };

/** Menu Categorias, aba Subcategorias (D77): cada uma com a categoria a que pertence. */
export default async function SubcategoriesPage() {
  const all = await listManagedCategories(getDb());
  const parentOf = new Map(all.map((c) => [c.id, c]));
  // agrupadas pela categoria (em ordem de nome), depois pelo nome
  const subs = all
    .filter((c) => c.parentId !== null)
    .map((c) => ({ c, parent: parentOf.get(c.parentId!)! }))
    .sort(
      (a, b) =>
        a.parent.name.localeCompare(b.parent.name, 'pt-BR') || a.c.name.localeCompare(b.c.name, 'pt-BR'),
    );
  const row = ({ c, parent }: (typeof subs)[number]) => (
    <CategoryLinkRow
      key={c.id}
      c={c}
      href={`/categorias/${c.id}?voltar=lista`}
      icon={c.icon ?? parent.icon}
      details={[parent.name, usageLabel(c.usageCount), aliasesLabel(c.botAliases)]}
    />
  );
  const active = subs.filter((s) => !s.c.archived);
  const archived = subs.filter((s) => s.c.archived);
  const empty = 'Nenhuma subcategoria. Crie uma aqui ou pelo + na edição de uma categoria.';

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Categorias"
        actions={
          <Button asChild size="sm">
            <Link href="/categorias/subcategorias/nova">
              <Plus aria-hidden /> Nova
            </Link>
          </Button>
        }
      />
      <CategoryTabs active="subcategorias" />
      <CategorySection title="Despesas" empty={empty}>
        {active.filter((s) => s.c.kind === 'EXPENSE').map(row)}
      </CategorySection>
      <CategorySection title="Receitas" empty={empty}>
        {active.filter((s) => s.c.kind === 'INCOME').map(row)}
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
