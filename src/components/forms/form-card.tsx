import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Card de uma tela de formulário: no desktop, card normal; no celular o formulário ocupa a tela sem moldura
 * (sem card dentro de card nem padding duplo, que tiravam ~30px úteis em 375px).
 */
export function FormCard({ className, ...props }: React.ComponentProps<typeof Card>) {
  return (
    <Card
      className={cn(
        'max-md:gap-4 max-md:border-0 max-md:bg-transparent max-md:py-0 max-md:shadow-none max-md:[&>[data-slot]]:px-0',
        className,
      )}
      {...props}
    />
  );
}
