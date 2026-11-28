/**
 * Menu lateral do desktop/iPad (≥ md): aberto (padrão) ou escondido. A escolha fica no aparelho (localStorage),
 * como o tema. O estado vai para <html data-sidebar>; o CSS (variante `sidebar-collapsed`) só olha para esse atributo.
 */
export type SidebarState = 'open' | 'collapsed';

export const SIDEBAR_KEY = 'finah-sidebar';
export const DEFAULT_SIDEBAR: SidebarState = 'open';

export function isSidebarState(v: unknown): v is SidebarState {
  return v === 'open' || v === 'collapsed';
}

/** Lê o estado guardado; qualquer falha (modo privado, valor estranho) cai no padrão (aberto). */
export function readSidebarState(): SidebarState {
  try {
    const v = window.localStorage.getItem(SIDEBAR_KEY);
    return isSidebarState(v) ? v : DEFAULT_SIDEBAR;
  } catch {
    return DEFAULT_SIDEBAR;
  }
}

/** Aplica no <html> e guarda no aparelho (sem armazenamento, vale só nesta sessão). */
export function setSidebarState(state: SidebarState) {
  document.documentElement.dataset.sidebar = state;
  try {
    window.localStorage.setItem(SIDEBAR_KEY, state);
  } catch {
    // sem armazenamento: vale só nesta sessão
  }
}

/**
 * Roda no <head> antes da primeira pintura (o menu não aparece e some ao abrir). Autocontido: não importa nada.
 * Mantenha em sincronia com SIDEBAR_KEY acima.
 */
export const SIDEBAR_INIT_SCRIPT = `(function(){try{if(localStorage.getItem('${SIDEBAR_KEY}')==='collapsed')document.documentElement.dataset.sidebar='collapsed'}catch(e){}})()`;
