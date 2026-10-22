/**
 * Tema do app. A preferência fica no aparelho (localStorage): "dark" (padrão), "light" ou "system".
 * O tema resolvido ("dark" | "light") vai para <html data-theme>; o CSS só olha para esse atributo.
 */
export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_KEY = 'finah-theme';
export const DEFAULT_THEME: ThemePreference = 'dark';

/** Cor da barra do navegador/PWA em cada tema (acompanha o fundo). */
export const THEME_COLOR: Record<ResolvedTheme, string> = { dark: '#0f1213', light: '#f5f7f7' };

export const THEME_LABEL: Record<ThemePreference, string> = {
  dark: 'Escuro',
  light: 'Claro',
  system: 'Sistema',
};

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === 'dark' || v === 'light' || v === 'system';
}

/** Lê a preferência guardada; qualquer falha (modo privado, valor estranho) cai no padrão. */
export function readThemePreference(): ThemePreference {
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return isThemePreference(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Aplica o tema no <html> e na cor da barra do navegador. */
export function applyTheme(pref: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((m) => m.setAttribute('content', THEME_COLOR[resolved]));
  return resolved;
}

export function saveThemePreference(pref: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_KEY, pref);
  } catch {
    // sem armazenamento: vale só nesta sessão
  }
}

/**
 * Roda no <head> antes da primeira pintura (evita piscar o tema errado). Autocontido: não importa nada.
 * Mantenha em sincronia com DEFAULT_THEME e THEME_KEY acima.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem('${THEME_KEY}');if(p!=='light'&&p!=='dark'&&p!=='system')p='${DEFAULT_THEME}';var d=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.dataset.theme=d}catch(e){}})()`;
