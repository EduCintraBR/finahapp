import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildSlices, TOP_SLICES } from '@/components/dashboard/slices';
import { PageHeader } from '@/components/layout/page-header';
import { Amount } from '@/components/money/amount';
import { CategoryLines } from '@/components/reports/category-lines';
import { Card } from '@/components/ui/card';
import { getDb } from '@/db/client';
import { categoryLines } from '@/db/queries/category-detail';
import { listCategories } from '@/db/queries/lookups';
import { ADJUSTMENTS_KEY, grossSpend, monthlySpend, NO_CATEGORY_KEY } from '@/db/queries/reports';
import { categoryLabel } from '@/domain/categories';
import { formatMonthLabel, monthEnd, toMonthParam } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { resolveMonth } from '@/lib/month';
import { filterParams, parseReportFilters, str } from '@/lib/report-filters';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Gasto por categoria' };

const OTHERS_KEY = 'outras';
const DIRECT = 'direto';
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Detalhe de uma categoria no mês (D75): o total é sempre igual à fatia do gráfico de onde se veio, com os
 * subtotais por subcategoria (botões que filtram a lista) e os lançamentos por dia. `visao` vem da origem:
 * Início = Bruto; Relatórios = o modo escolhido lá. A fatia "Outras" abre a lista das categorias que ficaram de fora.
 */
export default async function CategoryDetailPage({
  params,
  searchParams,
}: PageProps<'/relatorios/categoria/[id]'>) {
  const { id } = await params;
  if (!(isUuid(id) || id === NO_CATEGORY_KEY || id === ADJUSTMENTS_KEY || id === OTHERS_KEY)) notFound();
  const sp = await searchParams;
  const month = await resolveMonth(searchParams);
  const view = str(sp.visao) === 'bruto' ? 'bruto' : 'mensal';
  const fromHome = str(sp.de) === 'inicio';
  const filters = parseReportFilters(sp);
  const subParam = str(sp.sub);
  const end = monthEnd(month);
  const db = getDb();
  const mes = toMonthParam(month);
  const viewName = view === 'mensal' ? 'Gasto Mensal' : 'Gasto Bruto';

  const href = (key: string, over: Record<string, string> = {}) => {
    const q = new URLSearchParams({
      mes,
      visao: view,
      ...filterParams(sp),
      ...(fromHome ? { de: 'inicio' } : {}),
      ...over,
    });
    return `/relatorios/categoria/${key}?${q}`;
  };
  const backHref = fromHome
    ? `/?mes=${mes}`
    : `/relatorios?${new URLSearchParams({ mes, visao: view, ...filterParams(sp) })}`;
  const back = { href: backHref, label: fromHome ? 'Início' : 'Relatórios' };

  if (id === OTHERS_KEY) {
    const spend = view === 'bruto' ? grossSpend : monthlySpend;
    const [byCategory, categories] = await Promise.all([
      spend(db, month, end, 'category', filters),
      listCategories(db, { includeArchived: true }),
    ]);
    const nameOf = (key: string) =>
      key === ADJUSTMENTS_KEY
        ? 'Ajustes de fatura'
        : key === NO_CATEGORY_KEY
          ? 'Sem categoria'
          : (categories.find((c) => c.id === key)?.name ?? 'Categoria removida');
    const ranked = [...byCategory.entries()]
      .filter(([, v]) => v > 0)
      .map(([key, cents]) => ({ key, name: nameOf(key), cents }))
      .sort((a, b) => b.cents - a.cents);
    const rest = ranked.slice(TOP_SLICES);
    // a fatia "Outras" do gráfico é exatamente o que sobra depois das maiores
    const slice = buildSlices(ranked).find((s) => s.key === OTHERS_KEY);
    if (!slice) notFound();
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PageHeader
          title="Outras categorias"
          description={`${viewName} · ${formatMonthLabel(month)}`}
          back={back}
        />
        <Card className="gap-1 px-5 py-4">
          <div className="text-xs text-muted-foreground">As categorias fora das {TOP_SLICES} maiores</div>
          <Amount
            cents={slice.cents}
            className="text-3xl font-semibold tracking-tight"
            data-testid="category-total"
          />
        </Card>
        <ul className="divide-y rounded-lg border bg-card" aria-label="Categorias de Outras">
          {rest.map((r) => (
            <li key={r.key}>
              <Link href={href(r.key)} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                <Amount cents={r.cents} className="font-semibold" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const all = await categoryLines(db, view, month, end, id, filters);
  const [categories, named] = await Promise.all([
    listCategories(db, { alsoIds: all.map((l) => l.categoryId) }),
    listCategories(db, { includeArchived: true }),
  ]);
  const self = named.find((c) => c.id === id);
  if (isUuid(id) && !self) notFound();
  const name =
    id === ADJUSTMENTS_KEY ? 'Ajustes de fatura' : id === NO_CATEGORY_KEY ? 'Sem categoria' : self!.name;

  const totalCents = all.reduce((s, l) => s + l.amountCents, 0);
  // subtotais por subcategoria: "direto" = lançado na própria categoria, sem subcategoria
  const subs = categories.filter((c) => c.parentId === id);
  const subtotal = (match: (l: (typeof all)[number]) => boolean) =>
    all.filter(match).reduce((s, l) => s + l.amountCents, 0);
  const chips = [
    ...(subs.length > 0
      ? [
          { key: DIRECT, label: 'Sem subcategoria', cents: subtotal((l) => l.categoryId === id) },
          ...subs.map((s) => ({ key: s.id, label: s.name, cents: subtotal((l) => l.categoryId === s.id) })),
        ]
      : []),
  ].filter((c) => c.cents !== 0 || c.key === subParam);
  const active = subParam && chips.some((c) => c.key === subParam) ? subParam : null;
  const shown = active
    ? all.filter((l) => (active === DIRECT ? l.categoryId === id : l.categoryId === active))
    : all;
  const shownTotal = shown.reduce((s, l) => s + l.amountCents, 0);
  const parentName = self?.parentId ? named.find((c) => c.id === self.parentId)?.name : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={categoryLabel(name, parentName ?? null)}
        description={`${viewName} · ${formatMonthLabel(month)}`}
        back={back}
      />
      <Card className="gap-1 px-5 py-4">
        <div className="text-xs text-muted-foreground">
          Total da categoria no mês (igual à fatia do gráfico)
        </div>
        <Amount
          cents={totalCents}
          className="text-3xl font-semibold tracking-tight"
          data-testid="category-total"
        />
        <p className="text-xs text-muted-foreground">
          {view === 'bruto'
            ? 'Bruto: a compra aparece inteira no mês em que foi feita; o estorno, como linha negativa no mês do estorno.'
            : 'Mensal: o que sai da conta no mês; a compra parcelada aparece como a parcela da fatura que vence no mês.'}
        </p>
      </Card>

      {chips.length > 0 && (
        <nav aria-label="Subcategorias" className="flex flex-wrap gap-2">
          {[{ key: null, label: 'Todas', cents: totalCents }, ...chips].map((c) => (
            <Link
              key={c.key ?? 'todas'}
              href={c.key ? href(id, { sub: c.key }) : href(id)}
              aria-current={active === c.key ? 'true' : undefined}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors',
                active === c.key
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'hover:bg-accent',
              )}
            >
              {c.label} <span className="text-muted-foreground tabular-nums">{formatBRL(c.cents)}</span>
            </Link>
          ))}
        </nav>
      )}

      {active && (
        <p className="text-sm text-muted-foreground">
          Mostrando só esta subcategoria:{' '}
          <Amount cents={shownTotal} className="font-medium text-foreground" />
        </p>
      )}

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nenhum lançamento neste mês.</p>
      ) : (
        <CategoryLines lines={shown} categories={categories} />
      )}
    </div>
  );
}
