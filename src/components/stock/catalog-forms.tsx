'use client';

import { useActionState, useEffect, useRef } from 'react';
import {
  createStockCategoryAction,
  createStockLocationAction,
  createStockPersonAction,
  renameStockCategoryAction,
  renameStockLocationAction,
  renameStockPersonAction,
} from '@/app/(app)/casa/actions';
import { Field, FormError, NativeSelect } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useActionDone } from '@/components/ui/sheet-action';
import type { Option } from './stock-forms';

/** Limpa o campo depois de criar, para cadastrar vários seguidos. */
function useResetOnDone(state: { ok: boolean } | null) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

/** Categoria nova; com "Dentro de", vira subcategoria (2 níveis). */
export function NewStockCategoryForm({
  parents,
  defaultParentId,
}: {
  parents: Option[];
  defaultParentId?: string;
}) {
  const [state, action, pending] = useActionState(createStockCategoryAction, null);
  useActionDone(state, 'Categoria criada.');
  const ref = useResetOnDone(state);
  return (
    <form ref={ref} action={action} className="space-y-4">
      <Field label="Nome" htmlFor="stock-cat-name">
        <Input id="stock-cat-name" name="name" required maxLength={60} placeholder="Ex.: Pets, Enlatados" />
      </Field>
      <Field
        label="Dentro de"
        htmlFor="stock-cat-parent"
        hint="Escolha uma categoria para criar uma subcategoria."
      >
        <NativeSelect id="stock-cat-parent" name="parentId" defaultValue={defaultParentId ?? ''}>
          <option value="">Nenhuma: é uma categoria</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Criando…' : 'Criar'}
      </Button>
    </form>
  );
}

export function NewStockLocationForm() {
  const [state, action, pending] = useActionState(createStockLocationAction, null);
  useActionDone(state, 'Local criado.');
  const ref = useResetOnDone(state);
  return (
    <form ref={ref} action={action} className="flex items-start gap-2">
      <div className="min-w-0 flex-1 space-y-1.5">
        <Input
          aria-label="Nome do local"
          name="name"
          required
          maxLength={60}
          placeholder="Ex.: Despensa, Área de serviço"
        />
        <FormError message={state && !state.ok ? state.error : null} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Criando…' : 'Criar'}
      </Button>
    </form>
  );
}

/** Pessoa ou bicho da casa (D89). */
export function NewStockPersonForm() {
  const [state, action, pending] = useActionState(createStockPersonAction, null);
  useActionDone(state, 'Adicionado à lista.');
  const ref = useResetOnDone(state);
  return (
    <form ref={ref} action={action} className="flex items-start gap-2">
      <div className="min-w-0 flex-1 space-y-1.5">
        <Input aria-label="Nome" name="name" required maxLength={60} placeholder="Ex.: Liz, Molly" />
        <FormError message={state && !state.ok ? state.error : null} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Criando…' : 'Criar'}
      </Button>
    </form>
  );
}

const RENAME_ACTIONS = {
  category: renameStockCategoryAction,
  location: renameStockLocationAction,
  person: renameStockPersonAction,
};

/** Renomear categoria, local ou pessoa (painel do "⋯"). */
export function RenameForm({
  kind,
  id,
  name,
}: {
  kind: 'category' | 'location' | 'person';
  id: string;
  name: string;
}) {
  const [state, action, pending] = useActionState(RENAME_ACTIONS[kind], null);
  useActionDone(state, 'Nome salvo.');
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <Field label="Nome" htmlFor={`rename-${id}`}>
        <Input id={`rename-${id}`} name="name" required maxLength={60} defaultValue={name} />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Salvando…' : 'Salvar'}
      </Button>
    </form>
  );
}
