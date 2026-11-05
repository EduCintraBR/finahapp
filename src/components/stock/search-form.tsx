import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

/** Busca do estoque (vai para /casa/buscar). */
export function StockSearchForm({ defaultValue, autoFocus }: { defaultValue?: string; autoFocus?: boolean }) {
  return (
    <form action="/casa/buscar" role="search" className="relative">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        name="q"
        aria-label="Buscar no estoque"
        placeholder="Buscar: arroz, água, ARR-03…"
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        enterKeyHint="search"
        className="h-11 pl-9 text-base"
      />
    </form>
  );
}
