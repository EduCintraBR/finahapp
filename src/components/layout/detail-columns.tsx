/**
 * Tela de detalhe no desktop em duas colunas: à esquerda o resumo e as ações, à direita as listas (parcelas, itens,
 * histórico). No celular é uma coluna só, na mesma ordem. A tela que usa isto tem largura de detalhe
 * (`max-w-2xl lg:max-w-5xl`), para não sobrar espaço vazio ao lado no desktop.
 */
export function DetailColumns({ aside, children }: { aside: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start lg:gap-5 lg:space-y-0">
      <div className="space-y-4">{aside}</div>
      <div className="min-w-0 space-y-4">{children}</div>
    </div>
  );
}
