'use client';

import { useEffect, useState } from 'react';
import { keyboardInset } from '@/lib/keyboard-inset';

/** Altura (px) que o teclado virtual cobre no fundo da tela agora; 0 sem teclado ou fora do navegador. */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      setInset(
        keyboardInset({
          layoutHeight: window.innerHeight,
          height: vv.height,
          offsetTop: vv.offsetTop,
          scale: vv.scale,
        }),
      );
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}
