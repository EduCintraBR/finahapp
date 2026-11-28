import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SIDEBAR,
  isSidebarState,
  readSidebarState,
  SIDEBAR_INIT_SCRIPT,
  SIDEBAR_KEY,
} from './sidebar';

function fakeStorage(value: string | null, fail = false) {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => {
        if (fail) throw new Error('bloqueado');
        return k === SIDEBAR_KEY ? value : null;
      },
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('menu lateral (D96)', () => {
  it('aceita só "open" e "collapsed"', () => {
    expect(isSidebarState('open')).toBe(true);
    expect(isSidebarState('collapsed')).toBe(true);
    expect(isSidebarState('hidden')).toBe(false);
    expect(isSidebarState(null)).toBe(false);
  });

  it('lê o estado guardado; sem valor, valor estranho ou sem armazenamento fica aberto', () => {
    fakeStorage('collapsed');
    expect(readSidebarState()).toBe('collapsed');
    fakeStorage(null);
    expect(readSidebarState()).toBe(DEFAULT_SIDEBAR);
    fakeStorage('xyz');
    expect(readSidebarState()).toBe('open');
    fakeStorage('collapsed', true);
    expect(readSidebarState()).toBe('open');
  });

  it('o script do <head> usa a mesma chave', () => {
    expect(SIDEBAR_INIT_SCRIPT).toContain(`'${SIDEBAR_KEY}'`);
  });
});
