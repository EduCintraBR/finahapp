'use client';

import { useState } from 'react';
import { FileUp } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Campo de arquivo em pt-BR ("Escolher arquivo" e o nome do escolhido), no lugar do "Choose File" do navegador.
 * O `<input type=file>` continua lá (invisível, com o `id` do rótulo do Field), então o formulário e os testes
 * seguem usando o campo de sempre.
 */
export function FilePicker({
  id,
  onChange,
  className,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & { id: string }) {
  const [fileName, setFileName] = useState<string | null>(null);
  return (
    <div className={cn('flex items-center gap-3 rounded-md border border-dashed px-3 py-2.5', className)}>
      <input
        id={id}
        type="file"
        className="peer sr-only"
        {...props}
        onChange={(e) => {
          setFileName(e.target.files?.[0]?.name ?? null);
          onChange?.(e);
        }}
      />
      <label
        htmlFor={id}
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'shrink-0 cursor-pointer peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50',
        )}
      >
        <FileUp aria-hidden /> Escolher arquivo
      </label>
      <span className={cn('min-w-0 truncate text-sm', fileName ? 'font-medium' : 'text-muted-foreground')}>
        {fileName ?? 'Nenhum escolhido'}
      </span>
    </div>
  );
}
