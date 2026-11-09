import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { archiveCategoryAction, restoreCategoryAction } from '@/app/(app)/categorias/actions';
import { ChangeLevelForm, EditCategoryForm } from '@/components/categories/category-forms';
import {
  aliasesLabel,
  CategoryLinkRow,
  CategorySection,
  usageLabel,
} from '@/components/categories/category-list';
import { ActionButton } from '@/components/forms/action-button';
import { FormCard } from '@/components/forms/form-card';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { listManagedCategories, type ManagedCategory } from '@/db/queries/lookups';
import { isProtectedCategory } from '@/domain/categories';

export const metadata: Metadata = { title: 'Editar categoria' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const archiveText = (c: ManagedCategory, what: 'a categoria' | 'a subcategoria') =>
  c.usageCount > 0
    ? `Ela sai das listas de escolha. Os ${c.usageCount} lançamentos que já usam ${what} continuam com ela e os relatórios não mudam. Fica em "Arquivadas" e pode ser restaurada.`
    : 'Ela sai das listas de escolha. Fica em "Arquivadas" e pode ser restaurada.';

/**
 * Edição da categoria ou da subcategoria (D77). Na categoria, as subcategorias dela ficam listadas aqui, com o
 * "+" (abre o cadastro de subcategoria com esta categoria escolhida) e o remover (arquiva: nada é apagado, D49).
 */
export default async function EditCategoryPage({ params, searchParams }: PageProps<'/categorias/[id]'>) {
  const { id } = await params;
  const { voltar } = await searchParams;
  if (!UUID.test(id)) notFound();
  const all = await listManagedCategories(getDb());
  const c = all.find((x) => x.id === id);
  if (!c) notFound();

  const parent = c.parentId ? all.find((x) => x.id === c.parentId)! : null;
  const isSub = parent !== null;
  const isProtected = isProtectedCategory(c.kind, c.name);
  const parents = all
    .filter((x) => x.parentId === null && !x.archived)
    .map((x) => ({ id: x.id, name: x.name, kind: x.kind, icon: x.icon }));
  const children = all.filter((x) => x.parentId === c.id);
  const activeChildren = children.filter((x) => !x.archived);
  const archivedChildren = children.filter((x) => x.archived);
  const kindLabel = c.kind === 'EXPENSE' ? 'Despesa' : 'Receita';
  // categoria com subcategorias (mesmo arquivadas) não entra em outra; as protegidas não mudam de nível
  const canChangeLevel = !isProtected && !c.archived && children.length === 0;

  const back = !parent
    ? { href: '/categorias', label: 'Categorias' }
    : voltar === 'lista'
      ? { href: '/categorias/subcategorias', label: 'Subcategorias' }
      : { href: `/categorias/${parent.id}`, label: parent.name };

  const subRow = (s: ManagedCategory) => (
    <CategoryLinkRow
      key={s.id}
      c={s}
      href={`/categorias/${s.id}`}
      icon={s.icon ?? c.icon}
      details={[usageLabel(s.usageCount), aliasesLabel(s.botAliases)]}
      trailing={
        s.archived ? undefined : (
          <ActionButton
            action={archiveCategoryAction}
            fields={{ id: s.id }}
            label={`Remover ${s.name}`}
            variant="destructive"
            icon={<Trash2 aria-hidden />}
            confirm={{
              title: `Remover "${s.name}"?`,
              description: archiveText(s, 'a subcategoria'),
              confirmLabel: 'Remover',
            }}
          />
        )
      }
    />
  );

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {kindLabel}
            {parent ? ` · subcategoria de ${parent.name}` : ''} · {usageLabel(c.usageCount).toLowerCase()}
            {c.archived && <Badge variant="secondary">Arquivada</Badge>}
          </span>
        }
        back={back}
      />

      {!c.archived && (
        <FormCard>
          <CardContent>
            <EditCategoryForm c={c} isProtected={isProtected} parents={parents} />
          </CardContent>
        </FormCard>
      )}

      {!isSub && (
        <CategorySection
          title="Subcategorias"
          description="Opcionais: os relatórios somam tudo nesta categoria."
          empty={c.archived ? 'Nenhuma subcategoria ativa.' : 'Nenhuma subcategoria. Toque em + para criar.'}
          action={
            c.archived ? undefined : (
              <Button asChild size="sm" variant="outline">
                <Link
                  href={`/categorias/subcategorias/nova?categoria=${c.id}`}
                  aria-label="Nova subcategoria"
                >
                  <Plus aria-hidden /> Nova
                </Link>
              </Button>
            )
          }
        >
          {activeChildren.map(subRow)}
        </CategorySection>
      )}
      {!isSub && archivedChildren.length > 0 && (
        <CategorySection
          title="Subcategorias arquivadas"
          description="Os lançamentos antigos continuam com elas. Abra uma para restaurar."
        >
          {archivedChildren.map(subRow)}
        </CategorySection>
      )}

      {(canChangeLevel || !isProtected) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mais opções</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {canChangeLevel && <ChangeLevelForm c={c} parents={parents} />}
            {c.archived ? (
              <ActionButton
                action={restoreCategoryAction}
                fields={{ id: c.id }}
                label={isSub ? 'Restaurar subcategoria' : 'Restaurar categoria'}
              />
            ) : (
              <ActionButton
                action={archiveCategoryAction}
                fields={{ id: c.id }}
                label={isSub ? 'Remover subcategoria' : 'Arquivar categoria'}
                variant="destructive"
                confirm={{
                  title: isSub ? `Remover "${c.name}"?` : `Arquivar "${c.name}"?`,
                  description: archiveText(c, isSub ? 'a subcategoria' : 'a categoria'),
                  confirmLabel: isSub ? 'Remover' : 'Arquivar',
                }}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
