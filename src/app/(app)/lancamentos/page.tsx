import type { Metadata } from 'next';
import Link from 'next/link';
import { isScheduled } from '@/domain/account/rules';
import { FileUp, Landmark, Repeat, Scale, SlidersHorizontal } from 'lucide-react';
import { EntryList } from '@/components/entries/entry-list';
import { NativeSelect } from '@/components/forms/fields';
import { Amount } from '@/components/money/amount';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { getDb } from '@/db/client';
import { listEntries, type EntryFilters } from '@/db/queries/entries';
import { listCategories, listUsers } from '@/db/queries/lookups';
import { today, toMonthParam } from '@/domain/dates';
import { ACCOUNT_PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from '@/lib/labels';
import { resolveMonth } from '@/lib/month';
import { ensureOccurrences } from '@/server/ensure-occurrences';

export const metadata: Metadata = { title: 'Lançamentos' };

const str = (v: string | string[] | undefined) => (typeof v === 'string' && v !== '' ? v : undefined);
const oneOf = <T extends string>(v: string | undefined, allowed: readonly T[]) =>
  allowed.includes(v as T) ? (v as T) : undefined;
const uuidOrUndefined = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

export default async function EntriesPage({ searchParams }: PageProps<'/lancamentos'>) {
  await ensureOccurrences();
  const sp = await searchParams;
  const month = await resolveMonth(searchParams);
  const db = getDb();
  const hoje = today();

  const filters: EntryFilters = {
    month,
    kind: oneOf(str(sp.tipo), ['INCOME', 'EXPENSE'] as const),
    status: oneOf(str(sp.status), ['POSTED', 'PENDING'] as const),
    categoryId: uuidOrUndefined(str(sp.categoria)),
    paymentMethod: oneOf(str(sp.meio), ACCOUNT_PAYMENT_METHODS),
    createdBy: uuidOrUndefined(str(sp.lancou)),
    beneficiary: str(sp.dequem) === 'casal' ? 'casal' : uuidOrUndefined(str(sp.dequem)),
    q: str(sp.q)?.slice(0, 100),
  };
  const [entries, categories, users] = await Promise.all([
    listEntries(db, filters),
    listCategories(db, { includeArchived: true }),
    listUsers(db),
  ]);

  const sum = (pred: (e: (typeof entries)[number]) => boolean) =>
    entries.filter(pred).reduce((s, e) => s + e.amountCents, 0);
  // agendado (pago com data futura, D67) ainda não entrou nem saiu da conta: conta como a receber / a pagar
  const future = (e: (typeof entries)[number]) => isScheduled(e, hoje);
  const inPaid = sum((e) => e.status === 'POSTED' && !future(e) && e.kind === 'INCOME');
  const outPaid = sum((e) => e.status === 'POSTED' && !future(e) && e.kind === 'EXPENSE');
  const outPending = sum((e) => (e.status === 'PENDING' || future(e)) && e.kind === 'EXPENSE');
  const inPending = sum((e) => (e.status === 'PENDING' || future(e)) && e.kind === 'INCOME');

  const activeFilters = Object.entries(filters).filter(([k, v]) => k !== 'month' && v !== undefined).length;
  const mesParam = toMonthParam(month);
  const returnTo = `/lancamentos?${new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])))}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Lançamentos</h1>
        <div className="flex gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link href="/fixos" aria-label="Fixos">
              <Repeat aria-hidden />
              <span className="hidden sm:inline">Fixos</span>
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/emprestimos" aria-label="Empréstimos">
              <Landmark aria-hidden />
              <span className="hidden sm:inline">Empréstimos</span>
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/lancamentos/importar" aria-label="Importar extrato (OFX)">
              <FileUp aria-hidden />
              <span className="hidden sm:inline">Importar</span>
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/conta/conferencia" aria-label="Conferir">
              <Scale aria-hidden />
              <span className="hidden sm:inline">Conferir</span>
            </Link>
          </Button>
        </div>
      </div>

      <Card className="py-3">
        <CardContent className="grid grid-cols-2 gap-3 px-4 text-sm sm:grid-cols-4">
          <Stat label="Entradas" value={<Amount cents={inPaid} direction="in" />} />
          <Stat label="Saídas" value={<Amount cents={outPaid} direction="out" />} />
          <Stat label="A pagar" value={<Amount cents={outPending} className="text-muted-foreground" />} />
          <Stat label="A receber" value={<Amount cents={inPending} className="text-muted-foreground" />} />
        </CardContent>
      </Card>

      <details className="group rounded-xl border bg-card" open={activeFilters > 0}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
          <SlidersHorizontal className="size-4" aria-hidden /> Filtros
          {activeFilters > 0 && <span className="text-primary">({activeFilters})</span>}
        </summary>
        <form method="get" className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4">
          <input type="hidden" name="mes" value={mesParam} />
          <Input name="q" placeholder="Buscar descrição" defaultValue={filters.q} className="col-span-2" />
          <NativeSelect name="tipo" defaultValue={filters.kind ?? ''} aria-label="Tipo">
            <option value="">Receitas e despesas</option>
            <option value="EXPENSE">Despesas</option>
            <option value="INCOME">Receitas</option>
          </NativeSelect>
          <NativeSelect name="status" defaultValue={filters.status ?? ''} aria-label="Situação">
            <option value="">Pagos e pendentes</option>
            <option value="POSTED">Pagos</option>
            <option value="PENDING">Pendentes</option>
          </NativeSelect>
          <NativeSelect name="categoria" defaultValue={filters.categoryId ?? ''} aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="meio" defaultValue={filters.paymentMethod ?? ''} aria-label="Meio de pagamento">
            <option value="">Todos os meios</option>
            {ACCOUNT_PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="lancou" defaultValue={filters.createdBy ?? ''} aria-label="Quem lançou">
            <option value="">Lançado por qualquer um</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                Lançado por {u.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="dequem" defaultValue={filters.beneficiary ?? ''} aria-label="De quem é">
            <option value="">De qualquer um</option>
            <option value="casal">Do casal</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                De {u.name}
              </option>
            ))}
          </NativeSelect>
          <div className="col-span-2 flex gap-2 sm:col-span-4">
            <Button type="submit" size="sm">
              Filtrar
            </Button>
            {activeFilters > 0 && (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/lancamentos?mes=${mesParam}`}>Limpar</Link>
              </Button>
            )}
          </div>
        </form>
      </details>

      <EntryList entries={entries} today={hoje} returnTo={returnTo} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
