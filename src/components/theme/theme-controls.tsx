'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
  applyTheme,
  DEFAULT_THEME,
  readThemePreference,
  saveThemePreference,
  THEME_LABEL,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';
import { cn } from '@/lib/utils';

/** Quem quer saber quando o tema muda (troca na própria aba, em outra aba ou no sistema). */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onSystem = () => {
    if (readThemePreference() === 'system') applyTheme('system');
    cb();
  };
  mq.addEventListener('change', onSystem);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener('change', onSystem);
    window.removeEventListener('storage', cb);
  };
}

const readSystemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

/**
 * Preferência atual e como mudá-la. Tudo vem do aparelho por useSyncExternalStore: o servidor renderiza o padrão
 * (escuro) e, depois da hidratação, o valor real entra sem setState em efeito. O tema "resolvido" é derivado da
 * preferência (nunca lido do DOM), então o rótulo do botão nunca fica preso num valor velho.
 */
function useThemePreference() {
  const pref: ThemePreference = useSyncExternalStore(subscribe, readThemePreference, () => DEFAULT_THEME);
  const systemDark = useSyncExternalStore(subscribe, readSystemDark, () => true);
  const resolved: ResolvedTheme = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;

  // ao abrir: alinha a cor da barra do navegador com o que está guardado (o <html> o script do <head> já ajustou).
  // Lê o valor real do aparelho, não o snapshot do servidor, para não aplicar o tema errado por um instante.
  useEffect(() => {
    applyTheme(readThemePreference());
  }, []);

  const choose = (next: ThemePreference) => {
    saveThemePreference(next);
    applyTheme(next);
    notify();
  };
  return { pref, resolved, choose };
}

const ICON = { dark: Moon, light: Sun, system: Monitor } as const;

/** Botão rápido no cabeçalho: alterna entre escuro e claro. */
export function ThemeQuickToggle({ className }: { className?: string }) {
  const { pref, resolved, choose } = useThemePreference();
  const isDark = resolved === 'dark';
  const next: ThemePreference = isDark ? 'light' : 'dark';
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label={isDark ? 'Mudar para o tema claro' : 'Mudar para o tema escuro'}
      onClick={() => choose(next)}
      data-theme-pref={pref}
    >
      {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  );
}

/** Escolha completa (Escuro, Claro, Sistema), para Ajustes. */
export function ThemeSwitch() {
  const { pref, choose } = useThemePreference();
  return (
    <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
      {(['dark', 'light', 'system'] as const).map((t) => {
        const Icon = ICON[t];
        const active = pref === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => choose(t)}
            className={cn(
              'flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden /> {THEME_LABEL[t]}
          </button>
        );
      })}
    </div>
  );
}
