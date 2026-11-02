import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { CategoryIcon } from '@/components/categories/category-icon';
import type { ManagedCategory } from '@/db/queries/lookups';
import { cn } from '@/lib/utils';

/** Abas do menu Categorias (D77): categorias e subcategorias têm cada uma a sua lista e o seu cadastro. */
export function CategoryTabs({ active }: { active: 'categorias' | 'subcategorias' }) {
  const tabs = [
    { id: 'categorias', href: '/categorias', label: 'Categorias' },
    { id: 'subcategorias', href: '/categorias/subcategorias', label: 'Subcategorias' },
  ] as const;
  return (
    <div
      role="tablist"
      aria-label="Cadastro"
      className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm"
    >
      {tabs.map((t) => (
        <Link
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          href={t.href}
          className={cn(
            'rounded-md px-3 py-1.5 text-center font-medium transition-colors',
            active === t.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export const usageLabel = (n: number) =>
  n === 0 ? 'Sem lançamentos' : `${n} ${n === 1 ? 'lançamento' : 'lançamentos'}`;

export const aliasesLabel = (aliases: string[]) =>
  aliases.length === 0 ? null : `${aliases.slice(0, 4).join(', ')}${aliases.length > 4 ? '…' : ''}`;

/** Uma linha que abre a edição da categoria ou subcategoria. */
export function CategoryLinkRow({
  c,
  href,
  icon,
  details,
  trailing,
}: {
  c: ManagedCategory;
  href: string;
  /** ícone a mostrar (a subcategoria sem ícone usa o da categoria) */
  icon: string | null;
  details: (string | null | false)[];
  /** ação na própria linha (ex.: remover a subcategoria) */
  trailing?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-1 pr-2" data-testid="category-row">
      <Link
        href={href}
        className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 transition-colors hover:bg-accent/50"
      >
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg',
            c.archived ? 'bg-muted text-muted-foreground' : 'bg-primary/12 text-primary',
          )}
        >
          <CategoryIcon name={icon} className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block break-words', c.archived ? 'text-muted-foreground' : 'font-medium')}>
            {c.name}
          </span>
          <span className="block text-xs break-words text-muted-foreground">
            {details.filter(Boolean).join(' · ')}
          </span>
        </span>
        {!trailing && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
      </Link>
      {trailing}
    </li>
  );
}

/** Lista em card, com título e contagem; vazia mostra a mensagem. */
export function CategorySection({
  title,
  description,
  empty,
  action,
  children,
}: {
  title: string;
  description?: string;
  empty?: string;
  action?: React.ReactNode;
  children: React.ReactNode[];
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {empty ?? 'Nenhuma.'}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">{children}</ul>
      )}
    </section>
  );
}
