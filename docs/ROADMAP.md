# Finah — Roadmap Técnico

Cada fase termina com o app **rodando e utilizável**. Marque os itens à medida que forem concluídos. Uma fase só fecha quando os critérios de pronto passam.

---

## Fase 1 — Fundação

- [x] Scaffold do Next.js (App Router, TS strict, Tailwind, shadcn/ui, ESLint, Prettier), pnpm, `output: 'standalone'`
- [x] `src/db/schema.ts` + `drizzle/` já existentes; `drizzle.config.ts`; `src/db/client.ts`; scripts `db:*`
- [x] Seed: 2 usuários (de `.env`), categorias (`seed-data.ts`), conta principal com saldo inicial
- [x] Auth.js com credenciais (argon2id), sessão JWT de 30 dias, middleware protegendo tudo exceto `/login` e `/api/webhooks/*`, rate limit no login
- [x] `src/domain/money.ts` e `dates.ts` com testes, incluindo property tests (fast-check) do split de parcelas
- [x] Vitest configurado; `tests/acceptance/card-ledger.test.ts` rodando via `pnpm test:acceptance`
- [x] Dockerfile multi-stage multi-arch; `docker-compose.yml` com app, db, worker (stub), backup e caddy (perfil `vps`)
- [x] `.env.example` completo
- [x] Layout base mobile-first: navegação inferior no mobile, sidebar no desktop, seletor de mês, PWA manifest e ícones
- [x] CI (GitHub Actions): typecheck, lint, test, test:acceptance

**Pronto quando:**

- `docker compose up` sobe tudo do zero na VPS;
- os dois logins funcionam;
- o app é instalável no celular;
- um backup foi **restaurado com sucesso** num banco limpo.

> Status (17/10/2026): validado localmente com Docker Desktop: `docker compose up -d --build` sobe do zero (db → migrate → app/worker/backup), os dois logins funcionam, manifest/ícones/service worker respondem e um backup foi restaurado num banco limpo com as mesmas contagens. Falta: subir na VPS com o perfil `vps` (Caddy + HTTPS em `finahapp.com`) e instalar o PWA num celular real.

> ✅ 01/11/2026: o app roda em produção na VPS (finahapp.com) e o PWA foi instalado e testado em iPhone e Android reais, sem nenhum elemento coberto ou cortado.

---

## Fase 2 — Conta, fixos e recorrentes

- [x] CRUD de lançamentos da conta (receita e despesa à vista) com categoria, meio de pagamento, quem lançou e beneficiário
- [x] Saldo derivado; tela de extrato com filtros
- [x] Conferência de saldo (checkpoint) com lançamento de ajuste
- [x] CRUD de templates (FIXED, RECURRING_VARIABLE; despesa e receita), incluindo "alterar a partir de"
- [x] Geração idempotente de ocorrências do mês: job no worker + disparo ao abrir o mês
- [x] Fluxo "Confirmar pagamento" (data e valor reais), estornar baixa
- [x] Destaques: vence hoje, vence em 3 dias, atrasado
- [x] `audit_log` em todas as mutações
- [x] **Bot mínimo:** Telegram em modo webhook, só despesa à vista na conta, só texto, com confirmação e desfazer. Antecipado da Fase 5 para que vocês comecem a usar no dia a dia.

**Pronto quando:** depois de um mês real, o saldo do app bate com o extrato do banco. ✅ 01/11/2026: conferido pelo Eduardo, os saldos batem.

> Status (17/10/2026): todos os itens implementados e testados — 160 testes de unidade, 47 de aceitação (PGlite) e 9 E2E no navegador (Chromium, tela de 375px) cobrindo lançar, fixo, baixa em 2 toques, estorno, conferência e filtros; stack Docker local atualizada e conferida. O bot está pronto e testado com Telegram e LLM simulados, mas **desligado** (`BOT_MODE=off`, decisão D19): ligar na VPS com token do @BotFather, `ANTHROPIC_API_KEY` e os IDs numéricos do Telegram no seed (ver docs/GUIA.md). O critério "um mês real batendo com o banco" só se cumpre com o uso.

---

## Fase 3 — Motor de cartões

Primeiro `src/domain/card/` com testes; só depois os serviços e a UI.

- [x] CRUD de cartões (incluindo adicional com titular e limite opcional; sugestão de fechamento = vencimento − 7)
- [x] Geração e materialização de faturas; edição de datas de fechamento e vencimento
- [x] `resolveInvoice(card, purchaseDate)`; compra no cartão à vista e parcelada
- [x] Cálculo de limite; visão de fatura com itens; status derivado (aberta, fechada, atrasada, paga)
- [x] Pagar fatura (total por padrão; parcial permitido)
- [x] Antecipação: seleção de parcelas, bruto, desconto e pago, liquidação na fatura ou avulsa
- [x] Estorno Modo A e Modo B
- [x] Onboarding de parcelamentos em andamento ("parcela atual X de N")
- [x] Assinaturas no cartão (templates `CREDIT_CARD` geram compra automática)
- [x] Bot: compras no cartão e parceladas ("mercado 180 no nubank em 2x")

**Pronto quando:**

- uma fatura real do Nubank é reproduzida **centavo a centavo**; ✅ 17/10/2026: fatura de novembro/2026 importada por OFX — R$ 2.359,15 a pagar no app e no arquivo;
- o limite disponível do cartão do Eduardo bate com o app do Nubank. ✅ 01/11/2026: conferido pelo Eduardo, os limites batem.

> Status (17/10/2026): todos os itens implementados e testados — domínio em `src/domain/card/` (43 testes, com property tests de soma e de alocação), 15 testes de aceitação que reproduzem pelos serviços de produção os cenários de referência do `card-ledger.test.ts` (limite, total de fatura, saldo e Gasto Bruto batem com as fórmulas SQL), 15 do bot (compra parcelada pelo Telegram) e 8 E2E no navegador. Decisões D25–D33 na SPEC. Os dois critérios de pronto dependem de dados reais: cadastre o cartão com os dias certos, lance as compras do mês (ou os parcelamentos em andamento) e compare a fatura e o limite com o app do Nubank.

---

## Fase 4 — Dashboards e relatórios

- [x] Queries das fórmulas canônicas em `src/db/queries/`, com testes de aceitação comparando com os cenários
- [x] Home: KPI de saldo/balanço, Mensal vs Bruto (+ economia com antecipação), cards de cartões, pendentes, últimos lançamentos
- [x] Relatório por categoria (Bruto e Mensal, alternáveis), filtro por pessoa, cartão e meio de pagamento
- [x] Evolução mensal (últimos 12 meses), Bruto vs Mensal
- [x] Projeção de meses futuros (navegação livre)
- [x] Bot: `/saldo`, `/fatura`, `/pendentes`; lembretes diários às 9h

**Pronto quando:** dá para entender o mês em 5 segundos pelo celular, e os números da Home batem com os relatórios detalhados.

> ✅ 18/10/2026: Home com caixa do mês (D38), Mensal × Bruto e economia; relatórios com filtros e evolução de 12 meses (Recharts, paleta validada para daltonismo nos temas claro e escuro); projeção com saldo acumulado (D39–D41); bot com /saldo, /fatura, /pendentes e lembretes das 9h no worker (D43). E2E `tests/e2e/fase4.spec.ts` confere que os números da Home batem com os do relatório.

---

## Fase 5 — Importação e conciliação

- [x] Parser OFX genérico; adapter CSV da fatura Nubank; adapter CSV da conta principal (banco a confirmar)
- [x] Upload com hash de arquivo; preview das linhas
- [x] Motor de matching (score + atribuição 1:1) em `src/domain/reconciliation/`, com testes de ambiguidade (ex.: dois iFoods de mesmo valor na mesma semana)
- [x] Tela de revisão: aceitar, trocar match, criar lançamento, ignorar; ações em lote
- [x] Cartão adicional: linhas de terceiros → ignorar em lote
- [x] Bot completo: correção de lançamento, escolha de beneficiário, modo `polling` (preparação para o NAS)

> Adiantado em 17/10/2026, a pedido: **importação da fatura do cartão por OFX** (Nubank) com revisão. Prontos: parser OFX genérico (`src/importers/ofx.ts`, SGML e XML), classificação das linhas do Nubank, motor de matching 1:1 em `src/domain/reconciliation/` (com o teste dos "dois iFoods"), upload com hash, dedup por FITID, tela de revisão (aceitar, criar, ignorar, aceitar todas, criar todas) e conferência "a pagar no app × no arquivo". Decisões D34–D37. Faltam: CSV (fatura Nubank e conta), "trocar match" por outro candidato, ignorar em lote as linhas de terceiros do adicional, e o bot completo.

> 18/10/2026: **importação do extrato da conta por OFX** (Nubank). Linhas classificadas como despesa, receita, transferência (RDB, caixinha, Pix entre contas próprias) ou pagamento de fatura (inclusive Pix à titular do adicional); matching 1:1 contra os lançamentos da conta, incluindo pendentes (aceitar dá a baixa); conferência "saldo do app × saldo do arquivo" na data final; correção do saldo inicial em Ajustes (com audit_log). Decisões D44–D47.

> ✅ 18/10/2026: **Fase 5 concluída.** CSV do Nubank (conta e fatura, D51); **importar meses anteriores ao início do controle** recuando o saldo inicial com conferência (D50); trocar match, ignorar em lote (inclusive "todas menos as marcadas" no cartão adicional) e atualizar sugestões (D52); bot com ✏️ Corrigir de categoria e de quem é, antes e depois de lançar (D53). O modo polling do bot já existia. Os CSVs foram validados só com arquivos sintéticos (D51).

**Pronto quando:** importar o mesmo extrato duas vezes não muda nada, e um mês inteiro de extrato concilia sem duplicar nenhum lançamento.

> 18/10/2026, a pedido: **gestão de categorias** (Ajustes → Categorias): criar, renomear, apelidos do bot, arquivar/restaurar, com a regra de nunca apagar e a proteção das categorias de reserva. Decisão D49. Ícone e cor das categorias seguem fora da tela (a UI ainda não os usa).

> 21/10/2026, a pedido: **bot ampliado** (D54 a D56): consultas em linguagem natural e por comando (limite dos cartões, pendentes de um mês, resumo de fatura, gastos, resumo do mês, últimos lançamentos), com o mês atual como padrão, e **receitas** pelo bot. Modelo padrão: Claude Haiku 5.5.

> 21/10/2026, a pedido (uso real): **ajustes de usabilidade** (D57 a D60): dashboard do Início refeito (saldo e previsão, indicadores, pizza por categoria, barras de 6 meses, cartões, pendências), tema claro/escuro com revisão das cores, seletor de mês também nos cartões e faturas, itens da fatura por dia, "Nova compra" com o cartão pré-selecionado e volta para a fatura/lista do mês depois de lançar.

---

## Fase 6 — Subcategorias (D74 a D76)

Pedido do usuário (02/11/2026): reclassificar cada gasto na categoria e subcategoria reais, para ter noção exata de onde o dinheiro vai.

**Etapa 1 — Modelo e gestão** (D74)

- [x] Regras puras (`validateParent`, `findNameClash`, `categoryLabel`) com testes em `src/domain/categories.test.ts`
- [x] Serviço: criar subcategoria, `moveCategory` ("Mover para dentro de…"), arquivar/restaurar com a mãe, tudo com `audit_log`
- [x] Relatórios (Bruto, Mensal, filtros) e Lançamentos somam/filtram pela mãe; teste de aceitação: a soma por categoria-mãe é idêntica à de antes de mover
- [x] Ajustes → Categorias com subcategorias (criar "Dentro de", mover, arquivar); seletor de 2 níveis nos formulários; rótulo "Mãe › Filha" nas listas e no bot

**Etapa 2 — Detalhe da categoria** (D75)

- [x] `/relatorios/categoria/[id]?mes=…` a partir da pizza da Início e de Relatórios, com subtotais por subcategoria
- [x] Troca rápida de categoria (`setTransactionCategory`) com `audit_log`, fixos ("só este"/"este e os próximos"), empréstimo bloqueado, pagamento antecipado trocando os dois
- [x] Fatia "Outras" com a lista das categorias restantes

**Etapa 3 — Filtros e bot** (D76)

- [x] Filtro por subcategoria em Lançamentos e Relatórios
- [x] Apelidos próprios de subcategoria no bot

**Ajuste depois do teste em dev** (D77, 02/11/2026)

- [x] Categorias num menu próprio (`/categorias`, "Mais" e sidebar), fora de Ajustes; `/ajustes/categorias` redireciona
- [x] Abas Categorias e Subcategorias com cadastros separados; subcategoria exige a categoria
- [x] Edição da categoria lista as subcategorias, com remover (arquiva) e + (cadastro com a categoria já escolhida); edição da subcategoria troca a categoria dela

**Pronto quando:** reclassificar qualquer lançamento (conta, cartão, crediário, benefício) em categoria/subcategoria muda só a divisão por categoria, nunca o total de nenhum mês.

---

## Fase 7 — Orçamentos (D79)

Pedido do usuário (04/11/2026): cadastro de orçamento e metas, com gráficos e alertas para saber se o casal está passando do orçamento. Decisões: meta = teto do mês; medida = Gasto Mensal; alertas no app; valor fixo com ajuste a partir de um mês.

- [x] Regras puras (`amountForMonth`, `nextAmounts`, `budgetStatus`) com property tests em `src/domain/budgets/`
- [x] Schema `budgets` + `budget_amounts` (valor por mês, nulo = parou), serviço `setBudget`/`stopBudget` com `audit_log`
- [x] Queries: gasto de cada orçamento = Gasto Mensal canônico (categoria-mãe com subcategorias; teto = tudo), histórico de 6 meses; teste de aceitação comparando com `monthlySpend`
- [x] `/orcamentos` (alertas, teto com gráfico, categorias) e `/orcamentos/[id]` (gráfico, valores, mudar valor, parar); item no "Mais" e na sidebar
- [x] Painel "Orçamentos" na Início com o teto e as categorias perto ou acima do limite

**Pronto quando:** o gasto mostrado em cada orçamento é exatamente o Gasto Mensal da categoria (ou do mês, no teto) e mudar o valor a partir de um mês nunca muda os meses anteriores.

---

## Depois da v1 (backlog)

- Migração para o NAS (Tailscale, bot em polling)
- Áudio no bot (transcrição)
- Alertas de orçamento pelo Telegram
- Exportação CSV dos relatórios
