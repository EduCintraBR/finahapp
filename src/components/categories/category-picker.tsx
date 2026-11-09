'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { CategoryOption } from '@/db/queries/lookups';
import { categoryLabel } from '@/domain/categories';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from './category-icon';
import { QuickCategoryForm } from './quick-category-form';

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Com muitas categorias, a busca ajuda; com poucas, a grade inteira cabe na tela. */
const SEARCH_FROM = 10;

const TILE =
  'flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center text-xs leading-tight font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary';

/**
 * Escolha de categoria em grade de ícones, num painel inferior (um toque abre, outro escolhe e fecha). Categoria com
 * subcategorias (D74) abre uma segunda grade: a própria categoria ("sem subcategoria") e as filhas. O valor vai
 * num campo oculto `name`; o botão tem o `id` do rótulo, então "Categoria" continua sendo o nome acessível do campo.
 * O "+" ao lado da busca abre o cadastro rápido (do tipo `kind`) no próprio painel; ao criar, volta para a grade
 * já com a nova (e recarrega a página por trás, sem perder o que foi digitado no formulário).
 */
export function CategoryPicker({
  id,
  name,
  options: given,
  kind,
  value,
  onChange,
  invalid,
}: {
  id: string;
  name: string;
  options: CategoryOption[];
  /** tipo das categorias oferecidas: a criada pelo "+" nasce com ele */
  kind: 'EXPENSE' | 'INCOME';
  value: string;
  onChange: (id: string) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** mãe aberta na segunda grade (null = grade principal) */
  const [groupId, setGroupId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** criadas aqui e ainda não chegadas pelas props (o recarregamento da página demora um instante) */
  const [created, setCreated] = useState<CategoryOption[]>([]);
  const router = useRouter();
  const options = [
    ...given,
    ...created.filter((c) => c.kind === kind && !given.some((g) => g.id === c.id)),
  ].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const byId = new Map(options.map((o) => [o.id, o]));
  const parentOf = (o: CategoryOption) => (o.parentId ? (byId.get(o.parentId) ?? null) : null);
  const labelOf = (o: CategoryOption) => categoryLabel(o.name, parentOf(o)?.name ?? null);
  const iconOf = (o: CategoryOption) => o.icon ?? parentOf(o)?.icon ?? null;
  const tops = options.filter((o) => parentOf(o) === null);
  const childrenOf = (id: string) => options.filter((o) => o.parentId === id);
  const selected = byId.get(value);
  const group = groupId ? (byId.get(groupId) ?? null) : null;
  const shown = query ? options.filter((o) => fold(labelOf(o)).includes(fold(query))) : group ? [] : tops;

  const reset = () => {
    setQuery('');
    setGroupId(null);
    setCreating(false);
  };
  const onCreated = (c: CategoryOption) => {
    setCreated((prev) => [...prev, c]);
    router.refresh();
    setCreating(false);
    setQuery('');
    // volta para a grade onde ela aparece: a da categoria, se nasceu subcategoria
    setGroupId(c.parentId);
  };
  const choose = (categoryId: string) => {
    onChange(categoryId);
    setOpen(false);
    reset();
  };

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogTrigger asChild>
          <button
            id={id}
            type="button"
            data-invalid={invalid || undefined}
            className={cn(
              'flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-left text-base shadow-xs outline-none md:text-sm dark:bg-input/30',
              'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-invalid:border-destructive',
            )}
          >
            {selected ? (
              <>
                <CategoryIcon name={iconOf(selected)} className="size-4 shrink-0 text-primary" />
                <span className="truncate">{labelOf(selected)}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Escolha…</span>
            )}
            <ChevronDown className="ml-auto size-4 shrink-0 opacity-50" aria-hidden />
          </button>
        </DialogTrigger>
        {/* sem foco automático na busca: no celular ela abriria o teclado por cima da grade */}
        <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{creating ? 'Nova categoria' : 'Categoria'}</DialogTitle>
            <DialogDescription className="sr-only">
              {creating ? 'Crie uma categoria ou subcategoria.' : 'Escolha a categoria do lançamento.'}
            </DialogDescription>
          </DialogHeader>
          {creating ? (
            <QuickCategoryForm
              kind={kind}
              parents={tops.filter((o) => o.kind === kind)}
              defaultParentId={group?.id ?? null}
              onCreated={onCreated}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <>
              <div className="flex items-center gap-2">
                {options.length >= SEARCH_FROM && (
                  <Input
                    type="search"
                    aria-label="Buscar categoria"
                    placeholder="Buscar categoria"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                )}
                <Button
                  type="button"
                  variant="outline"
                  size={options.length >= SEARCH_FROM ? 'icon' : 'default'}
                  aria-label="Nova categoria"
                  title="Nova categoria"
                  onClick={() => setCreating(true)}
                  className={cn('shrink-0', options.length < SEARCH_FROM && 'ml-auto')}
                >
                  <Plus aria-hidden />
                  {options.length < SEARCH_FROM && 'Nova categoria'}
                </Button>
              </div>
              {group && !query && (
                <button
                  type="button"
                  onClick={() => setGroupId(null)}
                  className="-mt-1 flex w-fit items-center gap-1 text-sm text-primary outline-none focus-visible:underline"
                >
                  <ChevronLeft className="size-4" aria-hidden /> Todas as categorias
                </button>
              )}
              <div className="grid grid-cols-3 gap-2">
                {group && !query && (
                  <>
                    <button
                      type="button"
                      aria-pressed={group.id === value}
                      onClick={() => choose(group.id)}
                      className={TILE}
                    >
                      <CategoryIcon name={group.icon} className="size-5" />
                      <span className="line-clamp-2 break-words">{group.name}</span>
                      <span className="text-[10px] font-normal text-muted-foreground">sem subcategoria</span>
                    </button>
                    {childrenOf(group.id).map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        aria-pressed={o.id === value}
                        onClick={() => choose(o.id)}
                        className={TILE}
                      >
                        <CategoryIcon name={iconOf(o)} className="size-5" />
                        <span className="line-clamp-2 break-words">{o.name}</span>
                      </button>
                    ))}
                  </>
                )}
                {shown.map((o) => {
                  const kids = childrenOf(o.id).length;
                  const hasKids = kids > 0 && !query;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      aria-pressed={o.id === value || (hasKids && selected?.parentId === o.id)}
                      onClick={() => (hasKids ? setGroupId(o.id) : choose(o.id))}
                      className={cn(TILE, 'relative')}
                    >
                      <CategoryIcon name={iconOf(o)} className="size-5" />
                      <span className="line-clamp-2 break-words">{query ? labelOf(o) : o.name}</span>
                      {hasKids && (
                        <span className="absolute top-1.5 right-1.5 flex items-center text-[10px] font-normal text-muted-foreground">
                          {kids}
                          <ChevronRight className="size-3" aria-hidden />
                        </span>
                      )}
                    </button>
                  );
                })}
                {(query ? shown.length === 0 : !group && shown.length === 0) && (
                  <p className="col-span-3 py-6 text-center text-sm text-muted-foreground">
                    Nenhuma categoria com esse nome.
                  </p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
