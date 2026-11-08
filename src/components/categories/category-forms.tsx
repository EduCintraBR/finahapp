'use client';

import { useActionState, useState } from 'react';
import {
  createCategoryAction,
  createSubcategoryAction,
  moveCategoryAction,
  updateCategoryAction,
  updateSubcategoryAction,
} from '@/app/(app)/categorias/actions';
import { Field, FormError, NativeSelect } from '@/components/forms/fields';
import { StickyActions } from '@/components/forms/sticky-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { IconPicker } from './icon-picker';

type Kind = 'EXPENSE' | 'INCOME';
/** Categoria ativa (de topo): pode receber subcategorias (D74). */
export type ParentOption = { id: string; name: string; kind: Kind; icon: string | null };

const ALIAS_HINT =
  'Palavras que o bot e a importação usam para reconhecer. Separe por vírgula. Ex.: luz, energia, água';

const ICON_HINT = 'Aparece nas listas, nos lançamentos e na escolha da categoria.';
const SUB_ICON_HINT = 'Sem ícone próprio, a subcategoria usa o da categoria.';

const KIND_GROUPS: { kind: Kind; label: string }[] = [
  { kind: 'EXPENSE', label: 'Despesas' },
  { kind: 'INCOME', label: 'Receitas' },
];

/** Select de categoria agrupado por tipo; com `kind`, só as do tipo (a subcategoria nunca muda de tipo). */
function ParentSelect({
  id,
  parents,
  defaultValue,
  kind,
  onChange,
}: {
  id: string;
  parents: ParentOption[];
  defaultValue: string;
  kind?: Kind;
  onChange?: (parentId: string) => void;
}) {
  const groups = KIND_GROUPS.filter((g) => !kind || g.kind === kind);
  return (
    <NativeSelect
      id={id}
      name="parentId"
      required
      defaultValue={defaultValue}
      onChange={(e) => onChange?.(e.target.value)}
    >
      {!defaultValue && (
        <option value="" disabled>
          Escolha a categoria
        </option>
      )}
      {groups.map((g) => (
        <optgroup key={g.kind} label={g.label}>
          {parents
            .filter((p) => p.kind === g.kind)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </optgroup>
      ))}
    </NativeSelect>
  );
}

/** Nova categoria (de topo): nasce sem subcategorias; elas se criam depois, na edição. */
export function NewCategoryForm() {
  const [state, action, pending] = useActionState(createCategoryAction, null);
  return (
    <form action={action} className="space-y-4">
      <Field label="Nome" htmlFor="cat-name">
        <Input id="cat-name" name="name" required maxLength={60} placeholder="Ex.: Pets" />
      </Field>
      <Field label="Tipo" htmlFor="cat-kind" hint="Não muda depois de criada.">
        <NativeSelect id="cat-kind" name="kind" defaultValue="EXPENSE">
          <option value="EXPENSE">Despesa</option>
          <option value="INCOME">Receita</option>
        </NativeSelect>
      </Field>
      <Field label="Ícone" htmlFor="cat-icon" hint={ICON_HINT}>
        <IconPicker id="cat-icon" name="icon" defaultValue={null} />
      </Field>
      <Field label="Apelidos (opcional)" htmlFor="cat-aliases" hint={ALIAS_HINT}>
        <Input id="cat-aliases" name="aliases" placeholder="racao, veterinario, petshop" />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <StickyActions>
        <Button type="submit" disabled={pending}>
          {pending ? 'Criando…' : 'Criar categoria'}
        </Button>
      </StickyActions>
    </form>
  );
}

/** Nova subcategoria: a categoria é obrigatória (vem escolhida quando se chega pelo "+" da categoria). */
export function NewSubcategoryForm({
  parents,
  parentId,
  back,
}: {
  parents: ParentOption[];
  parentId: string | null;
  back: 'categoria' | 'lista';
}) {
  const [state, action, pending] = useActionState(createSubcategoryAction, null);
  const [chosen, setChosen] = useState(parentId ?? '');
  const parentIcon = parents.find((p) => p.id === chosen)?.icon ?? null;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="voltar" value={back} />
      <Field label="Categoria" htmlFor="sub-parent" hint="Os relatórios somam a subcategoria nela.">
        <ParentSelect id="sub-parent" parents={parents} defaultValue={parentId ?? ''} onChange={setChosen} />
      </Field>
      <Field label="Nome" htmlFor="sub-name">
        <Input id="sub-name" name="name" required maxLength={60} placeholder="Ex.: Hortifruti" />
      </Field>
      <Field label="Ícone" htmlFor="sub-icon" hint={SUB_ICON_HINT}>
        <IconPicker id="sub-icon" name="icon" defaultValue={null} inherited={{ icon: parentIcon }} />
      </Field>
      <Field label="Apelidos (opcional)" htmlFor="sub-aliases" hint={ALIAS_HINT}>
        <Input id="sub-aliases" name="aliases" placeholder="feira, sacolao" />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <StickyActions>
        <Button type="submit" disabled={pending}>
          {pending ? 'Criando…' : 'Criar subcategoria'}
        </Button>
      </StickyActions>
    </form>
  );
}

type Editable = {
  id: string;
  name: string;
  kind: Kind;
  parentId: string | null;
  icon: string | null;
  botAliases: string[];
};

/**
 * Edição: nome, ícone e apelidos; na subcategoria, também a categoria dela (mesmo tipo).
 * `isProtected` ("A classificar", "Outras receitas"): o nome não muda.
 */
export function EditCategoryForm({
  c,
  isProtected,
  parents,
}: {
  c: Editable;
  isProtected: boolean;
  parents: ParentOption[];
}) {
  const isSub = c.parentId !== null;
  const [state, action, pending] = useActionState(
    isSub ? updateSubcategoryAction : updateCategoryAction,
    null,
  );
  const [chosen, setChosen] = useState(c.parentId ?? '');
  const parentIcon = parents.find((p) => p.id === chosen)?.icon ?? null;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={c.id} />
      {isSub && (
        <Field
          label="Categoria"
          htmlFor="edit-parent"
          hint="Trocar não mexe nos lançamentos: o histórico passa a somar na categoria nova."
        >
          <ParentSelect
            id="edit-parent"
            parents={parents.filter((p) => p.id !== c.id)}
            defaultValue={c.parentId ?? ''}
            kind={c.kind}
            onChange={setChosen}
          />
        </Field>
      )}
      <Field
        label="Nome"
        htmlFor="edit-name"
        hint={isProtected ? 'Usada pelo bot e pelas importações: o nome não muda.' : undefined}
      >
        <Input
          id="edit-name"
          name="name"
          required
          maxLength={60}
          defaultValue={c.name}
          readOnly={isProtected}
        />
      </Field>
      <Field label="Ícone" htmlFor="edit-icon" hint={isSub ? SUB_ICON_HINT : ICON_HINT}>
        <IconPicker
          id="edit-icon"
          name="icon"
          defaultValue={c.icon}
          inherited={isSub ? { icon: parentIcon } : undefined}
        />
      </Field>
      <Field label="Apelidos" htmlFor="edit-aliases" hint={ALIAS_HINT}>
        <Textarea id="edit-aliases" name="aliases" rows={2} defaultValue={c.botAliases.join(', ')} />
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      {state?.ok && <p className="text-sm text-income">Salvo.</p>}
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? 'Salvando…' : 'Salvar'}
      </Button>
    </form>
  );
}

/**
 * Mudar o nível sem tocar em nenhum lançamento (D74): a categoria (sem subcategorias) vira subcategoria de outra,
 * ou a subcategoria volta a ser categoria.
 */
export function ChangeLevelForm({ c, parents }: { c: Editable; parents: ParentOption[] }) {
  const [state, action, pending] = useActionState(moveCategoryAction, null);
  const [parentId, setParentId] = useState('');
  if (c.parentId !== null) {
    return (
      <form action={action} className="space-y-2">
        <input type="hidden" name="id" value={c.id} />
        <input type="hidden" name="parentId" value="" />
        <p className="text-sm text-muted-foreground">
          Sai de dentro da categoria e passa a ser uma categoria. Os lançamentos continuam com ela.
        </p>
        <FormError message={state && !state.ok ? state.error : null} />
        <Button type="submit" variant="outline" disabled={pending} className="w-full sm:w-auto">
          {pending ? 'Aguarde…' : 'Transformar em categoria'}
        </Button>
      </form>
    );
  }
  const options = parents.filter((p) => p.kind === c.kind && p.id !== c.id);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={c.id} />
      <Field
        label="Transformar em subcategoria de…"
        htmlFor="move-parent"
        hint="Nenhum lançamento muda: o histórico passa a somar na categoria escolhida."
      >
        <NativeSelect
          id="move-parent"
          name="parentId"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="" disabled>
            Escolha a categoria
          </option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <FormError message={state && !state.ok ? state.error : null} />
      <Button type="submit" variant="outline" disabled={pending || !parentId} className="w-full sm:w-auto">
        {pending ? 'Aguarde…' : 'Transformar'}
      </Button>
    </form>
  );
}
