import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { CASA_MORE_GROUPS } from '@/components/layout/nav-items';

export const metadata: Metadata = { title: 'Mais' };

/** "Mais" da Casa (celular): cadastros, a volta para as Finanças e os ajustes (no desktop, na sidebar). */
export default function CasaMorePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Mais" />
      {CASA_MORE_GROUPS.map((group) => (
        <section key={group.title} aria-label={group.title} className="space-y-2">
          <h2 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {group.title}
          </h2>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {group.items.map(({ href, label, description, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
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
