/** Abaixo disso a diferença é a barra de endereço aparecendo/sumindo, não um teclado. */
const MIN_KEYBOARD = 120;

/**
 * Quanto do fundo da tela o teclado virtual cobre, a partir do `visualViewport`. No iPhone (Safari e PWA) o teclado
 * não encolhe a página: elementos `fixed` no fundo ficam atrás dele. Subindo-os por esse valor, o botão continua
 * à vista. Com zoom dos dedos (scale ≠ 1) a área visível também encolhe, sem teclado: aí não sobe nada.
 */
export function keyboardInset(v: {
  layoutHeight: number;
  height: number;
  offsetTop: number;
  scale: number;
}): number {
  if (v.scale !== 1) return 0;
  const covered = Math.round(v.layoutHeight - (v.height + v.offsetTop));
  return covered >= MIN_KEYBOARD ? covered : 0;
}
