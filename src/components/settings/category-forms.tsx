'use client';

import { useActionState, useRef, useState } from 'react';
import {
  archiveCategoryAction,
  createCategoryAction,
  moveCategoryAction,
  restoreCategoryAction,
  updateCategoryAction,
} from '@/app/(app)/ajustes/categorias/actions';
import { ActionButton } from '@/components/forms/action-button';
import { Field, FormError, NativeSelect } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ManagedCategory } from '@/db/queries/lookups';

/** Categoria de topo ativa: pode receber subcategorias (D74). */
export type ParentOption = { id: string; name: string; kind: 'EXPENSE' | 'INCOME' };

const ALIAS_HINT =
  'Palavras que o bot e a importação usam para reconhecer. Separe por vírgula. Ex.: luz, energia, água';

export function CreateCategoryForm({ parents }: { parents: ParentOption[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [state, action, pending] = useActionState(
    async (prev: Parameters<typeof createCategoryAction>[0], fd: FormData) => {
      const r = await createCategoryAction(prev, fd);
      if (r.ok) formRef.current?.reset();
      return r;
    },
    null,
  );
  return (
    <form ref={formRef} action={action} className="grid grid-cols-2 gap-3">
      <Field label="Nome" htmlFor="cat-new-name" className="col-span-2 sm:col-span-1">
        <Input id="cat-new-name" name="name" required maxLength={60} placeholder="Ex.: Pets" />
      </Field>
      <Field label="Tipo" htmlFor="cat-new-kind" className="col-span-2 sm:col-span-1">
        <NativeSelect
          id="cat-new-kind"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'EXPENSE' | 'INCOME')}
        >
          <option value="EXPENSE">Despesa</option>
          <option value="INCOME">Receita</option>
        </NativeSelect>
      </Field>
      <Field
        label="Dentro de (opcional)"
        htmlFor="cat-new-parent"
        hint="Para criar uma subcategoria, escolha a categoria. Os relatórios somam tudo na categoria."
        className="col-span-2"
      >
        <NativeSelect key={kind} id="cat-new-parent" name="parentId" defaultValue="">
          <option value="">Nenhuma (categoria de topo)</option>
          {parents
            .filter((p) => p.kind === kind)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <Field label="Apelidos (opcional)" htmlFor="cat-new-aliases" hint={ALIAS_HINT} className="col-span-2">
        <Input id="cat-new-aliases" name="aliases" placeholder="racao, veterinario, petshop" />
      </Field>
      <div className="col-span-2 space-y-2">
        <FormError message={state && !state.ok ? state.error : null} />
        {state?.ok && <p className="text-sm text-income">Categoria criada.</p>}
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? 'Criando…' : 'Criar categoria'}
        </Button>
      </div>
    </form>
  );
}

/** "Mover para dentro de…": vira subcategoria de outra, ou volta ao topo. Não mexe em nenhum lançamento. */
function MoveForm({ c, parents }: { c: ManagedCategory; parents: ParentOption[] }) {
  const [state, action, pending] = useActionState(moveCategoryAction, null);
  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="id" value={c.id} />
      <Field
        label="Mover para dentro de…"
        htmlFor={`cat-parent-${c.id}`}
        hint="Nenhum lançamento muda: o histórico se reagrupa sozinho nos relatórios."
      >
        <NativeSelect id={`cat-parent-${c.id}`} name="parentId" defaultValue={c.parentId ?? ''}>
          <option value="">Nenhuma (categoria de topo)</option>
          {parents
            .filter((p) => p.kind === c.kind && p.id !== c.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </NativeSelect>
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      {state?.ok && <p className="text-sm text-income">Movida.</p>}
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? 'Movendo…' : 'Mover'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Uma categoria: resumo na linha, edição (nome e apelidos), mover e arquivar/restaurar ao expandir.
 * `parentName` indica subcategoria (recuada); com `childCount` > 0 a categoria não pode entrar em outra.
 */
export function CategoryRow({
  c,
  isProtected,
  parents,
  parentName = null,
  childCount = 0,
}: {
  c: ManagedCategory;
  isProtected: boolean;
  parents: ParentOption[];
  parentName?: string | null;
  childCount?: number;
}) {
  const [state, action, pending] = useActionState(updateCategoryAction, null);
  const canMove = !isProtected && !c.archived && childCount === 0;
  const indent = parentName ? 'pl-9' : 'pl-4';
  return (
    <details className="group border-b last:border-b-0" data-testid="category-row">
      <summary className={`flex cursor-pointer list-none items-center gap-3 py-3 pr-4 ${indent}`}>
        <div className="min-w-0 flex-1">
          <div className={c.archived ? 'truncate text-muted-foreground' : 'truncate font-medium'}>
            {c.name}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {parentName && `em ${parentName} · `}
            {childCount > 0 && `${childCount} ${childCount === 1 ? 'subcategoria' : 'subcategorias'} · `}
            {c.usageCount === 0
              ? 'Sem lançamentos'
              : `${c.usageCount} ${c.usageCount === 1 ? 'lançamento' : 'lançamentos'}`}
            {c.botAliases.length > 0 &&
              ` · ${c.botAliases.slice(0, 4).join(', ')}${c.botAliases.length > 4 ? '…' : ''}`}
          </div>
        </div>
        <span className="text-xs text-primary group-open:hidden">Editar</span>
        <span className="hidden text-xs text-muted-foreground group-open:inline">Fechar</span>
      </summary>
      <div className={`space-y-3 pr-4 pb-4 ${indent}`}>
        <form action={action} className="grid gap-3">
          <input type="hidden" name="id" value={c.id} />
          <Field
            label="Nome"
            htmlFor={`cat-name-${c.id}`}
            hint={isProtected ? 'Usada pelo bot e pelas importações: o nome não muda.' : undefined}
          >
            <Input
              id={`cat-name-${c.id}`}
              name="name"
              required
              maxLength={60}
              defaultValue={c.name}
              readOnly={isProtected}
            />
          </Field>
          <Field label="Apelidos" htmlFor={`cat-aliases-${c.id}`} hint={ALIAS_HINT}>
            <Textarea
              id={`cat-aliases-${c.id}`}
              name="aliases"
              rows={2}
              defaultValue={c.botAliases.join(', ')}
            />
          </Field>
          <FormError message={state && !state.ok ? state.error : null} />
          {state?.ok && <p className="text-sm text-income">Salvo.</p>}
          <div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </form>
        {canMove && <MoveForm c={c} parents={parents} />}
        {c.archived ? (
          <ActionButton action={restoreCategoryAction} fields={{ id: c.id }} label="Restaurar categoria" />
        ) : isProtected ? null : (
          <ActionButton
            action={archiveCategoryAction}
            fields={{ id: c.id }}
            label="Arquivar categoria"
            variant="destructive"
            confirm={{
              title: `Arquivar "${c.name}"?`,
              description:
                c.usageCount > 0
                  ? `Ela deixa de aparecer nas listas de escolha. Os ${c.usageCount} lançamentos que já usam esta categoria e os relatórios continuam iguais. Você pode restaurá-la quando quiser.`
                  : 'Ela deixa de aparecer nas listas de escolha. Você pode restaurá-la quando quiser.',
              confirmLabel: 'Arquivar',
            }}
          />
        )}
      </div>
    </details>
  );
}
