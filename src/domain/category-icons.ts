/**
 * Catálogo dos ícones que se podem escolher para uma categoria ou subcategoria (nome do Lucide gravado em
 * categories.icon). Puro: o servidor valida o nome por aqui e a tela mapeia cada nome para o componente em
 * components/categories/category-icon.tsx. Inclui todos os ícones do seed (seed-data.ts).
 * Rótulos em pt-BR: viram o nome acessível de cada opção e alimentam a busca.
 */
export const CATEGORY_ICON_GROUPS = [
  {
    label: 'Casa e contas',
    icons: [
      ['house', 'Casa'],
      ['sofa', 'Sofá'],
      ['bed', 'Cama'],
      ['lamp', 'Luminária'],
      ['plug', 'Tomada'],
      ['zap', 'Energia'],
      ['droplet', 'Água'],
      ['flame', 'Gás'],
      ['wifi', 'Internet'],
      ['smartphone', 'Celular'],
      ['tv', 'TV'],
      ['wrench', 'Manutenção'],
      ['hammer', 'Reforma'],
      ['paint-roller', 'Pintura'],
      ['key', 'Aluguel'],
    ],
  },
  {
    label: 'Alimentação',
    icons: [
      ['utensils', 'Restaurante'],
      ['shopping-cart', 'Mercado'],
      ['apple', 'Hortifruti'],
      ['coffee', 'Café'],
      ['croissant', 'Padaria'],
      ['sandwich', 'Lanche'],
      ['pizza', 'Pizza'],
      ['ice-cream-cone', 'Sorvete'],
      ['beer', 'Cerveja'],
      ['wine', 'Vinho'],
    ],
  },
  {
    label: 'Transporte',
    icons: [
      ['car', 'Carro'],
      ['fuel', 'Combustível'],
      ['square-parking', 'Estacionamento'],
      ['car-taxi-front', 'Táxi e app'],
      ['bus', 'Ônibus'],
      ['train-front', 'Metrô e trem'],
      ['bike', 'Bicicleta'],
      ['plane', 'Viagem'],
    ],
  },
  {
    label: 'Saúde e cuidados',
    icons: [
      ['heart-pulse', 'Saúde'],
      ['pill', 'Farmácia'],
      ['stethoscope', 'Consulta'],
      ['hospital', 'Hospital'],
      ['dumbbell', 'Academia'],
      ['scissors', 'Cabeleireiro'],
      ['sparkles', 'Beleza'],
    ],
  },
  {
    label: 'Pessoas e pets',
    icons: [
      ['baby', 'Bebê'],
      ['user', 'Pessoa'],
      ['users', 'Família'],
      ['dog', 'Cachorro'],
      ['cat', 'Gato'],
      ['paw-print', 'Pet'],
      ['gift', 'Presente'],
      ['cake', 'Aniversário'],
    ],
  },
  {
    label: 'Lazer',
    icons: [
      ['party-popper', 'Festa'],
      ['gamepad-2', 'Jogos'],
      ['film', 'Cinema'],
      ['music', 'Música'],
      ['ticket', 'Ingressos'],
      ['book-open', 'Livros'],
      ['palette', 'Arte'],
      ['tent', 'Camping'],
      ['tree-palm', 'Praia'],
    ],
  },
  {
    label: 'Compras',
    icons: [
      ['shopping-bag', 'Compras'],
      ['shirt', 'Roupas'],
      ['gem', 'Joias'],
      ['glasses', 'Óculos'],
      ['watch', 'Relógio'],
      ['package', 'Encomenda'],
      ['store', 'Loja'],
    ],
  },
  {
    label: 'Estudo e trabalho',
    icons: [
      ['graduation-cap', 'Educação'],
      ['school', 'Escola'],
      ['book', 'Material escolar'],
      ['briefcase', 'Trabalho'],
      ['building-2', 'Empresa'],
      ['laptop', 'Computador'],
    ],
  },
  {
    label: 'Dinheiro',
    icons: [
      ['coins', 'Moedas'],
      ['banknote', 'Dinheiro'],
      ['wallet', 'Carteira'],
      ['piggy-bank', 'Cofrinho'],
      ['hand-coins', 'Empréstimo'],
      ['circle-dollar-sign', 'Renda'],
      ['trending-up', 'Rendimento'],
      ['landmark', 'Banco'],
      ['credit-card', 'Cartão'],
      ['receipt', 'Conta a pagar'],
      ['percent', 'Juros e taxas'],
    ],
  },
  {
    label: 'Outros',
    icons: [
      ['tag', 'Etiqueta'],
      ['star', 'Estrela'],
      ['heart', 'Coração'],
      ['church', 'Igreja'],
      ['leaf', 'Natureza'],
      ['globe', 'Mundo'],
      ['calendar', 'Agenda'],
      ['repeat', 'Assinatura'],
      ['circle-plus', 'Outras receitas'],
      ['circle-ellipsis', 'Outros'],
      ['circle-help', 'A classificar'],
    ],
  },
] as const satisfies readonly { label: string; icons: readonly (readonly [string, string])[] }[];

export type CategoryIconName = (typeof CATEGORY_ICON_GROUPS)[number]['icons'][number][0];

/** Todos os ícones, na ordem dos grupos. */
export const CATEGORY_ICONS: readonly { name: CategoryIconName; label: string; group: string }[] =
  CATEGORY_ICON_GROUPS.flatMap((g) => g.icons.map(([name, label]) => ({ name, label, group: g.label })));

const NAMES = new Set<string>(CATEGORY_ICONS.map((i) => i.name));

export const isCategoryIcon = (name: string): name is CategoryIconName => NAMES.has(name);

/** Rótulo pt-BR do ícone (null se não está no catálogo). */
export const categoryIconLabel = (name: string | null): string | null =>
  (name && CATEGORY_ICONS.find((i) => i.name === name)?.label) || null;
