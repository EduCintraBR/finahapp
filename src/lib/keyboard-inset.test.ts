import { describe, expect, it } from 'vitest';
import { keyboardInset } from './keyboard-inset';

describe('keyboardInset: quanto do fundo da tela o teclado virtual cobre', () => {
  it('sem teclado: 0', () => {
    expect(keyboardInset({ layoutHeight: 812, height: 812, offsetTop: 0, scale: 1 })).toBe(0);
  });
  it('teclado aberto: a altura que sobra embaixo da área visível', () => {
    expect(keyboardInset({ layoutHeight: 812, height: 476, offsetTop: 0, scale: 1 })).toBe(336);
  });
  it('a página rolou para mostrar o campo (offsetTop) e o teclado continua cobrindo o mesmo tanto', () => {
    expect(keyboardInset({ layoutHeight: 812, height: 476, offsetTop: 120, scale: 1 })).toBe(216);
  });
  it('ignora variações pequenas (barra de endereço) e o zoom com os dedos', () => {
    expect(keyboardInset({ layoutHeight: 812, height: 760, offsetTop: 0, scale: 1 })).toBe(0);
    expect(keyboardInset({ layoutHeight: 812, height: 400, offsetTop: 0, scale: 2 })).toBe(0);
  });
});
