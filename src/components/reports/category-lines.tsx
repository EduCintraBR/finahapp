'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { Tag } from 'lucide-react';
import { setCategoryAction } from '@/app/(app)/relatorios/categoria/actions';
import { CategoryPicker } from '@/components/categories/category-picker';
import { FormError } from '@/components/forms/fields';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';
import type { CategoryLine } from '@/db/queries/category-detail';
import type { CategoryOption } from '@/db/queries/lookups';
import { categoryLabel } from '@/domain/categories';
import { formatDateBR, formatDayLabel } from '@/domain/dates';
import { formatBRL } from '@/domain/money';

/** Onde abrir o lançamento: a compra no cartão tem tela própria; os demais, o detalhe do lançamento. */
function lineHref(l: CategoryLine): string | null {
  if (l.planId) return `/cartoes/compras/${l.planId}`;
  return l.transactionId ? `/lancamentos/${l.transactionId}` : null;
}

/**
 * Lista do detalhe da categoria, por dia. Tocar na linha abre o lançamento; o botão da etiqueta abre o painel
 * "Trocar categoria" (um só para a lista inteira) com o seletor de 2 níveis e, nos fixos, "só este" ou "este e os próximos".
 */
export function CategoryLines({
  lines,
  categories,
}: {
  lines: CategoryLine[];
  categories: CategoryOption[];
}) {
  const [editing, setEditing] = useState<CategoryLine | null>(null);
  const nameOf = (id: string | null) => {
    const c = categories.find((x) => x.id === id);
    return c ? categoryLabel(c.name, categories.find((p) => p.id === c.parentId)?.name ?? null) : null;
  };

  const days: { date: string; items: CategoryLine[] }[] = [];
  for (const l of lines) {
    const last = days[days.length - 1];
    if (last && last.date === l.date) last.items.push(l);
    else days.push({ date: l.date, items: [l] });
  }

  return (
    <>
      <div className="space-y-4">
        {days.map((d) => (
          <section key={d.date} aria-label={formatDateBR(d.date)}>
            <h3 className="px-1 pb-1 text-xs font-medium text-muted-foreground first-letter:uppercase">
              {formatDayLabel(d.date)}
            </h3>
            <ul className="divide-y rounded-lg border bg-card">
              {d.items.map((l) => {
                const href = lineHref(l);
                const body = (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{l.description}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[l.detail, nameOf(l.categoryId)].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <Amount
                      cents={Math.abs(l.amountCents)}
                      direction={l.amountCents < 0 ? 'in' : undefined}
                      className="text-sm font-semibold"
                    />
                  </>
                );
                return (
                  <li key={l.key} className="flex items-center gap-1 pr-1" data-testid="category-line">
                    {href ? (
                      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5">{body}</div>
                    )}
                    {l.lockedReason === null ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Trocar a categoria de ${l.description}`}
                        onClick={() => setEditing(l)}
                      >
                        <Tag aria-hidden />
                      </Button>
                    ) : (
                      <span className="size-9 shrink-0" title={l.lockedReason} aria-hidden />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <ChangeForm
              key={editing.key}
              line={editing}
              categories={categories}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChangeForm({
  line,
  categories,
  onDone,
}: {
  line: CategoryLine;
  categories: CategoryOption[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(setCategoryAction, null);
  const [categoryId, setCategoryId] = useState(line.categoryId ?? '');
  const options = categories.filter((c) => c.kind === 'EXPENSE');
  useEffect(() => {
    if (!state?.ok) return;
    toast('Categoria trocada.');
    onDone();
  }, [state, onDone]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Trocar categoria</DialogTitle>
        <DialogDescription>
          {line.description} · {formatBRL(Math.abs(line.amountCents))}. Muda só a categoria: valor e datas
          ficam como estão.
        </DialogDescription>
      </DialogHeader>
      <form action={action} className="grid gap-3">
        <input type="hidden" name="id" value={line.transactionId ?? ''} />
        <input type="hidden" name="version" value={line.version ?? 0} />
        <div className="grid gap-1.5">
          <label htmlFor="change-category" className="text-sm font-medium">
            Categoria
          </label>
          <CategoryPicker
            id="change-category"
            name="categoryId"
            options={options}
            value={categoryId}
            onChange={setCategoryId}
          />
        </div>
        {line.recurringTemplateId && (
          <fieldset className="grid gap-2 rounded-lg border p-3 text-sm">
            <legend className="px-1 text-xs text-muted-foreground">Este lançamento vem de um fixo</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" value="THIS" defaultChecked /> Só este
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" value="THIS_AND_FUTURE" /> Este e os próximos
            </label>
            <p className="text-xs text-muted-foreground">
              &ldquo;Este e os próximos&rdquo; também muda o fixo e as contas pendentes dali em diante. As já
              pagas ficam como estão.
            </p>
          </fieldset>
        )}
        <FormError message={state && !state.ok ? state.error : null} />
        <Button type="submit" disabled={pending || !categoryId || categoryId === line.categoryId}>
          {pending ? 'Salvando…' : 'Trocar categoria'}
        </Button>
      </form>
    </>
  );
}
