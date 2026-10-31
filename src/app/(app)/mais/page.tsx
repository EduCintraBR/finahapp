import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { MORE_GROUPS } from '@/components/layout/nav-items';
import { withMonth } from '@/components/layout/month-link';

export const metadata: Metadata = { title: 'Mais' };

/** Aba "Mais" do celular: as seções que não cabem na barra inferior (no desktop estão na sidebar). */
export default async function MorePage({ searchParams }: PageProps<'/mais'>) {
  const { mes } = await searchParams;
  const params = new URLSearchParams(typeof mes === 'string' ? { mes } : {});

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Mais" />
      {MORE_GROUPS.map((group) => (
        <section key={group.title} aria-label={group.title} className="space-y-2">
          <h2 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {group.title}
          </h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {group.items.map(({ href, label, description, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={withMonth(href, params)}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent active:bg-accent"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{label}</span>
                    {description && (
                      <span className="block text-sm text-muted-foreground">{description}</span>
                    )}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
