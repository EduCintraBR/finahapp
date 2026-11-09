'use client';

import { useState, useTransition } from 'react';
import { ChevronLeft } from 'lucide-react';
import { quickCreateCategoryAction } from '@/app/(app)/categorias/actions';
import { Field, FormError, NativeSelect } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CategoryOption } from '@/db/queries/lookups';
import { IconPicker } from './icon-picker';

/**
 * Cadastro rápido dentro do seletor de categoria: nome, "Dentro de" (vazio = categoria nova; com uma categoria,
 * nasce subcategoria dela) e ícone. O tipo é o do formulário que abriu o seletor. Não usa <form>: o seletor já
 * está dentro do formulário do lançamento, e o envio não pode disparar o dele.
 */
export function QuickCategoryForm({
  kind,
  parents,
  defaultParentId,
  onCreated,
  onCancel,
}: {
  kind: 'EXPENSE' | 'INCOME';
  /** categorias de topo do tipo, que podem receber subcategorias */
  parents: CategoryOption[];
  defaultParentId: string | null;
  onCreated: (created: CategoryOption) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState(defaultParentId ?? '');
  const [icon, setIcon] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const parentIcon = parents.find((p) => p.id === parentId)?.icon ?? null;
  const what = parentId ? 'subcategoria' : 'categoria';

  const submit = () => {
    if (!name.trim()) {
      setError('Informe o nome.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await quickCreateCategoryAction({ kind, name, parentId, icon });
      if (r.ok) onCreated(r.data);
      else setError(r.error);
    });
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onCancel}
        className="-mt-1 flex w-fit items-center gap-1 text-sm text-primary outline-none focus-visible:underline"
      >
        <ChevronLeft className="size-4" aria-hidden /> Voltar para a escolha
      </button>
      <Field label="Nome da categoria" htmlFor="quick-cat-name">
        <Input
          id="quick-cat-name"
          required
          maxLength={60}
          placeholder="Ex.: Pets"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      </Field>
      <Field
        label="Dentro de"
        htmlFor="quick-cat-parent"
        hint="Escolha uma categoria para criar uma subcategoria."
      >
        <NativeSelect id="quick-cat-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">Nenhuma (categoria nova)</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Ícone" htmlFor="quick-cat-icon">
        <IconPicker
          // a herança muda com a mãe escolhida: remonta para refletir "Igual à categoria" ou a etiqueta
          key={parentId ? 'sub' : 'top'}
          id="quick-cat-icon"
          name="icon"
          defaultValue={icon || null}
          inherited={parentId ? { icon: parentIcon } : undefined}
          onChange={setIcon}
        />
      </Field>
      <FormError message={error} />
      <Button type="button" onClick={submit} disabled={pending} className="w-full">
        {pending ? 'Criando…' : `Criar ${what}`}
      </Button>
    </div>
  );
}
