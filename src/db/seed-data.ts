/**
 * Dados de seed. Usuários e cartões vêm de variáveis de ambiente (nunca commitar senhas).
 * botAliases: termos que o parser do bot reconhece para a categoria (minúsculas, sem acento).
 */
export const seedCategories = {
  EXPENSE: [
    { name: 'Moradia',           icon: 'house',          botAliases: ['aluguel', 'condominio', 'iptu'] },
    { name: 'Contas da casa',    icon: 'plug',           botAliases: ['luz', 'energia', 'agua', 'gas', 'internet', 'celular'] },
    { name: 'Mercado',           icon: 'shopping-cart',  botAliases: ['mercado', 'super', 'supermercado', 'feira', 'hortifruti', 'padaria'] },
    { name: 'Alimentação fora',  icon: 'utensils',       botAliases: ['restaurante', 'ifood', 'delivery', 'lanche', 'almoco', 'jantar'] },
    { name: 'Transporte',        icon: 'car',            botAliases: ['gasolina', 'combustivel', 'uber', '99', 'estacionamento', 'pedagio'] },
    { name: 'Saúde',             icon: 'heart-pulse',    botAliases: ['farmacia', 'remedio', 'consulta', 'exame', 'plano de saude'] },
    { name: 'Filhos',            icon: 'baby',           botAliases: ['fralda', 'pediatra', 'escola', 'creche'] },
    { name: 'Educação',          icon: 'graduation-cap', botAliases: ['curso', 'livro', 'faculdade'] },
    { name: 'Lazer',             icon: 'party-popper',   botAliases: ['cinema', 'passeio', 'bar', 'show'] },
    { name: 'Assinaturas',       icon: 'repeat',         botAliases: ['netflix', 'spotify', 'streaming', 'assinatura', 'prime'] },
    { name: 'Compras',           icon: 'shopping-bag',   botAliases: ['roupa', 'loja', 'amazon', 'shopee', 'mercado livre'] },
    { name: 'Casa e manutenção', icon: 'wrench',         botAliases: ['reforma', 'conserto', 'movel', 'eletro'] },
    { name: 'Cuidados pessoais', icon: 'sparkles',       botAliases: ['cabelo', 'barbeiro', 'salao', 'academia'] },
    { name: 'Presentes',         icon: 'gift',           botAliases: ['presente', 'aniversario'] },
    { name: 'Viagens',           icon: 'plane',          botAliases: ['viagem', 'hotel', 'passagem', 'airbnb'] },
    { name: 'Tarifas e juros',   icon: 'receipt',        botAliases: ['iof', 'anuidade', 'juros', 'tarifa', 'multa'] },
    { name: 'Outros',            icon: 'circle-ellipsis', botAliases: [] },
    { name: 'A classificar',     icon: 'circle-help',    botAliases: [] }, // fallback do bot/import
  ],
  INCOME: [
    { name: 'Salário CLT',    icon: 'briefcase',     botAliases: ['salario', 'clt'] },
    { name: 'Renda PJ',       icon: 'building-2',    botAliases: ['pj', 'nota', 'prolabore'] },
    { name: 'Renda extra',    icon: 'coins',         botAliases: ['extra', 'freela', 'venda'] },
    { name: 'Outras receitas', icon: 'circle-plus',  botAliases: ['reembolso', 'presente recebido'] },
  ],
} as const;
