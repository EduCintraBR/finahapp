'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { CATEGORY_ICON_GROUPS, CATEGORY_ICONS, categoryIconLabel } from '@/domain/category-icons';
import { cn } from '@/lib/utils';
import { CategoryIcon } from './category-icon';

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const TILE =
  'flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border p-1.5 text-center text-[11px] leading-tight transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary';

/**
 * Escolha do ícone da categoria/subcategoria: um botão mostra o atual e abre um painel com a grade do catálogo
 * (domain/category-icons.ts), agrupada e com busca pelo rótulo. O valor vai num campo oculto `name`; vazio =
 * sem ícone próprio. Com `inherited` (subcategoria), a primeira opção é "Igual à categoria", que mostra o ícone da
 * mãe (a subcategoria sem ícone usa o dela, ver categoryIconSql); sem ele, vazio mostra a etiqueta.
 */
export function IconPicker({
  id,
  name,
  defaultValue,
  inherited,
}: {
  id: string;
  name: string;
  defaultValue: string | null;
  /** só na subcategoria: o ícone da categoria (null se ela também não tem) */
  inherited?: { icon: string | null } | undefined;
}) {
  const [value, setValue] = useState(defaultValue ?? '');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const canInherit = inherited !== undefined;
  const shownIcon = value || (canInherit ? inherited.icon : null);
  const triggerLabel = value
    ? (categoryIconLabel(value) ?? 'Etiqueta')
    : canInherit
      ? 'Igual à categoria'
      : 'Etiqueta (padrão)';
  const q = fold(query.trim());
  const matches = q ? CATEGORY_ICONS.filter((i) => fold(i.label).includes(q)) : [];

  const choose = (icon: string) => {
    setValue(icon);
    setOpen(false);
    setQuery('');
  };
  const tile = (icon: string, label: string) => (
    <button
      key={icon}
      type="button"
      aria-pressed={icon === value}
      aria-label={label}
      title={label}
      onClick={() => choose(icon)}
      className={TILE}
    >
      <CategoryIcon name={icon} className="size-5" />
      <span className="line-clamp-2 break-words" aria-hidden>
        {label}
      </span>
    </button>
  );

  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery('');
        }}
      >
        <DialogTrigger asChild>
          <button
            id={id}
            type="button"
            className={cn(
              'flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-left text-base shadow-xs outline-none md:text-sm dark:bg-input/30',
              'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
            )}
          >
            <CategoryIcon name={shownIcon} className="size-4 shrink-0 text-primary" />
            <span className="truncate">{triggerLabel}</span>
            <ChevronDown className="ml-auto size-4 shrink-0 opacity-50" aria-hidden />
          </button>
        </DialogTrigger>
        {/* sem foco automático na busca: no celular ela abriria o teclado por cima da grade */}
        <DialogContent onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Ícone</DialogTitle>
            <DialogDescription className="sr-only">Escolha o ícone da categoria.</DialogDescription>
          </DialogHeader>
          <Input
            type="search"
            aria-label="Buscar ícone"
            placeholder="Buscar ícone (ex.: mercado, pet)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {canInherit && !q && (
            <button
              type="button"
              aria-pressed={value === ''}
              onClick={() => choose('')}
              className={cn(TILE, 'min-h-12 flex-row gap-2 text-sm')}
            >
              <CategoryIcon name={inherited.icon} className="size-5" />
              Igual à categoria
            </button>
          )}
          {q ? (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {matches.map((i) => tile(i.name, i.label))}
              {matches.length === 0 && (
                <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
                  Nenhum ícone com esse nome.
                </p>
              )}
            </div>
          ) : (
            CATEGORY_ICON_GROUPS.map((g) => (
              <section key={g.label} aria-label={g.label} className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">{g.label}</h3>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {g.icons.map(([icon, label]) => tile(icon, label))}
                </div>
              </section>
            ))
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
