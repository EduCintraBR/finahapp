'use client';

import { useActionState, useRef } from 'react';
import {
  archiveCategoryAction,
  createCategoryAction,
  restoreCategoryAction,
  updateCategoryAction,
} from '@/app/(app)/ajustes/categorias/actions';
import { ActionButton } from '@/components/forms/action-button';
import { Field, FormError, NativeSelect } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ManagedCategory } from '@/db/queries/lookups';

const ALIAS_HINT =
  'Palavras que o bot e a importação usam para reconhecer. Separe por vírgula. Ex.: luz, energia, água';

export function CreateCategoryForm() {
  const formRef = useRef<HTMLFormElement>(null);
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
        <NativeSelect id="cat-new-kind" name="kind" defaultValue="EXPENSE">
          <option value="EXPENSE">Despesa</option>
          <option value="INCOME">Receita</option>
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

/** Uma categoria: resumo na linha, edição (nome e apelidos) e arquivar/restaurar ao expandir. */
export function CategoryRow({ c, isProtected }: { c: ManagedCategory; isProtected: boolean }) {
  const [state, action, pending] = useActionState(updateCategoryAction, null);
  return (
    <details className="group border-b last:border-b-0" data-testid="category-row">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className={c.archived ? 'truncate text-muted-foreground' : 'truncate font-medium'}>
            {c.name}
          </div>
          <div className="truncate text-xs text-muted-foreground">
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
      <div className="space-y-3 px-4 pb-4">
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
