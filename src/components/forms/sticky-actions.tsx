'use client';

import { useKeyboardInset } from '@/hooks/use-keyboard-inset';
import { cn } from '@/lib/utils';

/**
 * Botões de um formulário sempre à vista no celular: barra fixa logo acima da navegação inferior e, com o teclado
 * aberto (iPhone), logo acima do teclado. No desktop fica no fim do formulário, como um botão comum. Vai dentro do
 * `<form>` (o submit continua funcionando); o espaçador evita que o último campo fique atrás da barra.
 */
export function StickyActions({ children, className }: { children: React.ReactNode; className?: string }) {
  const kb = useKeyboardInset();
  return (
    <>
      {/* do tamanho da barra (botão h-11 + py-3 + borda), para o último campo não ficar atrás dela */}
      <div aria-hidden className="h-[4.5rem] md:hidden" />
      <div
        data-slot="sticky-actions"
        className={cn(
          'fixed inset-x-0 z-30 border-t bg-background/95 px-4 py-3 backdrop-blur',
          !kb && 'bottom-[calc(4rem+env(safe-area-inset-bottom))]',
          'md:static md:z-auto md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none',
          className,
        )}
        style={kb ? { bottom: kb } : undefined}
      >
        <div className="mx-auto flex max-w-lg gap-2 *:flex-1">{children}</div>
      </div>
    </>
  );
}
