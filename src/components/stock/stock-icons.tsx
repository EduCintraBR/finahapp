import { Bath, Boxes, Droplets, Pill, Shirt, SprayCan, Wheat, type LucideIcon } from 'lucide-react';
import { formatDateBR, type ISODate } from '@/domain/dates';
import type { ExpiryLevel } from '@/domain/stock/quantity';
import { cn } from '@/lib/utils';

/** Ícones das categorias da Casa (nome do Lucide em stock_categories.icon); desconhecido → caixas. */
const ICONS: Record<string, LucideIcon> = {
  bath: Bath,
  droplets: Droplets,
  pill: Pill,
  shirt: Shirt,
  'spray-can': SprayCan,
  wheat: Wheat,
};

export function StockCategoryIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && ICONS[name]) || Boxes;
  return <Icon className={className} aria-hidden />;
}

const EXPIRY_TEXT: Record<ExpiryLevel, string> = { expired: 'Venceu', soon: 'Vence', ok: 'Vence' };

/** Selo da validade: vencido em vermelho, vencendo (30 dias) em amarelo; a palavra diz a situação, não só a cor. */
export function ExpiryBadge({
  date,
  level,
  label = 'Vence',
  className,
}: {
  date: ISODate | null;
  level: ExpiryLevel | null;
  /** "Trocar até" na água (D85, etapa 2); padrão "Vence" */
  label?: string;
  className?: string;
}) {
  if (!date || !level) return null;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        level === 'expired' && 'bg-expense/15 text-expense',
        level === 'soon' && 'bg-warning/20 text-warning-text',
        level === 'ok' && 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {level === 'expired' ? EXPIRY_TEXT.expired : label} {formatDateBR(date)}
    </span>
  );
}

export function LowBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-warning-text',
        className,
      )}
    >
      Acabando
    </span>
  );
}
