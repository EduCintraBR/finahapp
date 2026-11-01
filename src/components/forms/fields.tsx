import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { maskMoneyInput } from '@/domain/money';
import { cn } from '@/lib/utils';

/** Campo com rótulo; `error` (em vermelho) substitui a dica. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/**
 * Valor em reais com máscara de centavos primeiro (digitar 1234 mostra "12,34"), como nos apps de banco: não precisa
 * digitar a vírgula. O texto mascarado ("1.234,56") é o que vai no formulário; a conversão para centavos é feita no
 * servidor (parseBRL), nunca com float no navegador.
 */
export function MoneyInput({
  className,
  prefixClassName,
  onChange,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & { prefixClassName?: string }) {
  return (
    <div className="relative">
      <span
        className={cn(
          'pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground',
          prefixClassName,
        )}
      >
        R$
      </span>
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="0,00"
        className={cn('pl-9 text-base tabular-nums', className)}
        {...props}
        onChange={(e) => {
          e.target.value = maskMoneyInput(e.target.value);
          onChange?.(e);
        }}
      />
    </div>
  );
}

/** Select nativo (no celular abre o seletor do sistema, que é mais rápido). */
export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm dark:bg-input/30',
        className,
      )}
      {...props}
    />
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}
