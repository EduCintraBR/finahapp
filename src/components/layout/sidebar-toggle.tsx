'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { DEFAULT_SIDEBAR, readSidebarState, setSidebarState, type SidebarState } from '@/lib/sidebar';
import { cn } from '@/lib/utils';

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  // outra aba mudou: aplica aqui também
  const onStorage = () => {
    document.documentElement.dataset.sidebar = readSidebarState();
    cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

/**
 * Botão do cabeçalho (só ≥ md, onde existe o menu lateral) que esconde e mostra o menu. O estado vem do aparelho
 * por useSyncExternalStore: o servidor renderiza o padrão (aberto) e o script do <head> já escondeu o menu antes da
 * primeira pintura, então nada pisca.
 */
export function SidebarToggle({ className }: { className?: string }) {
  const state: SidebarState = useSyncExternalStore(subscribe, readSidebarState, () => DEFAULT_SIDEBAR);
  const collapsed = state === 'collapsed';
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn('hidden md:inline-flex', className)}
      aria-label={collapsed ? 'Mostrar menu' : 'Esconder menu'}
      aria-controls="app-sidebar"
      aria-expanded={!collapsed}
      onClick={() => {
        setSidebarState(collapsed ? 'open' : 'collapsed');
        listeners.forEach((l) => l());
      }}
    >
      <Icon aria-hidden />
    </Button>
  );
}
