import { cn } from '@/lib/utils';

/** Bolinha com a inicial de quem lançou (cor do usuário, definida no seed). */
export function UserBadge({
  name,
  color,
  className,
}: {
  name: string;
  color: string | null;
  className?: string;
}) {
  return (
    <span
      title={`Lançado por ${name}`}
      aria-label={`Lançado por ${name}`}
      className={cn(
        'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
        !color && 'bg-muted-foreground',
        className,
      )}
      style={color ? { backgroundColor: color } : undefined}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
