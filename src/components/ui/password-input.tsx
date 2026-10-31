'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from 'cn';
import { Input } from '@/components/ui/input';

/**
 * Campo de senha com botão para mostrar/ocultar o texto. O nome do botão vem do texto oculto (sr-only),
 * não de aria-label: assim o campo continua com o rótulo "Senha" para leitores de tela e para os testes.
 */
function PasswordInput({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className={cn('pr-10', className)} />
      <button
        type="button"
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
        <span className="sr-only">{visible ? 'Ocultar senha' : 'Mostrar senha'}</span>
      </button>
    </div>
  );
}

export { PasswordInput };
