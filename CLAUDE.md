# Finah — Controle Financeiro do Casal

App web self-hosted para 2 usuários (Eduardo e esposa) controlarem uma conta principal compartilhada e cartões de crédito. Prioridade absoluta: **precisão contábil — nenhum centavo errado**. Segunda prioridade: uso rápido no celular (PWA + bot do Telegram).

Leia antes de qualquer tarefa de domínio: `docs/SPEC.md` (regras e decisões) e `docs/ROADMAP.md` (fase atual e critérios de pronto).

## Stack

- Next.js (App Router) + TypeScript `strict` — `output: 'standalone'`
- Tailwind CSS + shadcn/ui + Lucide + Recharts
- PostgreSQL 16+ via Drizzle ORM (`src/db/schema.ts`), migrações com drizzle-kit em `drizzle/`
- Auth.js — provider de credenciais (email + senha argon2id), sessão JWT de 30 dias, sem tabelas de sessão
- Zod para toda entrada (forms, Server Actions, payloads do bot, linhas de import)
- Vitest + fast-check; testes de banco com PGlite (`@electric-sql/pglite`)
- Jobs: pg-boss em container `worker` separado
- Bot: grammY (Telegram); parsing via Anthropic SDK com saída estruturada
- PWA instalável (manifest + service worker; não precisa funcionar offline)
- pnpm. Ao instalar dependências, use as versões estáveis atuais e fixe-as no package.json.

## Comandos

(manter esta lista atualizada)

- `pnpm dev` · `pnpm build` (Next standalone + `dist/{worker,migrate,seed}.mjs`) · `pnpm lint` · `pnpm typecheck` (`next typegen && tsc`)
- `pnpm format` / `pnpm format:check` (Prettier; o CI checa)
- `pnpm test` (unit + domínio, `src/**/*.test.ts`) · `pnpm test:acceptance` (PGlite + migrações, `tests/acceptance/`)
- `pnpm test:e2e` (Playwright/Chromium em 375px contra `next dev :3100` com `NEXT_DIST_DIR=.next-e2e`, que roda ao lado do `pnpm dev` do dia a dia, e o banco **separado** `finah_e2e`; precisa de `docker compose up -d db`)
- `pnpm db:generate` (drizzle-kit generate) · `pnpm db:migrate` · `pnpm db:seed` · `pnpm worker` (lêem o `.env`)
- `docker compose up -d --build` (db, migrate one-shot, app, worker, backup; caddy com `--profile vps`)
- `docker compose run --rm app node dist/seed.mjs` · `docker compose exec backup backup.sh` · `docker compose exec backup restore.sh latest`
- `bash scripts/compose-smoke.sh` (stack do zero → seed → 2 logins → PWA → worker → backup/restore; roda no CI)
- `pnpm tsx scripts/generate-icons.tsx` (regera os PNGs do PWA em `public/icons/`)
- `VPS=root@<ip> bash scripts/sync-db-to-vps.sh` (copia o banco local para a VPS; ver docs/GUIA.md, só para a carga inicial)
- `pnpm bot:webhook` / `pnpm bot:webhook --remove` (registra/remove o webhook do Telegram; só na VPS)

Notas do Next 16: middleware agora é `src/proxy.ts`; `next lint` não existe (use `pnpm lint`); docs da versão instalada em `node_modules/next/dist/docs/`.

## Estrutura

```
src/
  app/                 rotas, layouts, Server Actions finas (só orquestram)
  domain/              REGRAS PURAS — sem Next, sem DB, sem Date.now() implícito
    money.ts           centavos, parse/format BRL, split de parcelas
    dates.ts           aritmética de DATE 'YYYY-MM-DD', meses, dia de fechamento
    card/              resolveInvoice, buildInstallments, anticipation, refund, limit
    reports/           competência (bruto), caixa (mensal), projeção
    recurring/         geração de ocorrências
    reconciliation/    scoring e atribuição 1:1 de matches
  server/              serviços que unem domain + db, sempre em db.transaction()
  db/                  schema.ts, client.ts, seed.ts, seed-data.ts, queries/ (fórmulas canônicas em SQL)
  bot/                 handlers grammY, parser (LLM), formatação de respostas
  importers/           ofx.ts, csv/nubank-card.ts, csv/nubank-account.ts, ...
  worker/              entrypoint do container worker (pg-boss + polling do bot)
tests/acceptance/      cenários de ponta a ponta contra Postgres real (PGlite)
```

## Invariantes de domínio — NUNCA violar

1. **Dinheiro é inteiro em centavos** (`number`, coluna BIGINT mode 'number'). Proibido `float` para dinheiro, `toFixed` para cálculo, ou `parseFloat` de input. Converter para reais só na camada de apresentação (`formatBRL`).
2. **Datas de negócio são strings `'YYYY-MM-DD'`** (coluna DATE mode 'string'). Nunca `new Date('2026-10-16')` para lógica (vira UTC e muda o dia em America/Sao_Paulo). "Hoje" vem de uma função `today(tz = 'America/Sao_Paulo')` injetável.
3. **Saldo, limite e total de fatura NUNCA são armazenados** — sempre derivados (fórmulas abaixo). Não crie colunas de cache sem discutir antes.
4. **Toda compra no cartão = 1 transaction (EXPENSE) + 1 installment_plan + N invoice_items.** À vista é plano de 1 parcela. Σ parcelas = total; o resto do arredondamento vai na **1ª parcela**.
5. **Alocação de fatura:** a compra vai para a fatura do cartão com a **menor `closing_date` > data da compra**. Faturas são materializadas com datas reais e editáveis; se não existir, crie a partir de `closingDay/dueDay` (dia inexistente no mês → último dia do mês).
6. **`INVOICE_PAYMENT` não é gasto.** Ele só mexe no saldo e no limite. Gasto vem das transactions EXPENSE (bruto) e dos invoice_items (mensal). Contar os dois = contagem dupla.
7. **Lançamentos financeiros não são apagados fisicamente**: `deleted_at` (transactions) ou `status = CANCELLED/ANTICIPATED` (invoice_items). Toda mutação relevante grava `audit_log`.
8. **Toda operação de escrita multi-tabela roda em `db.transaction()`** (compra parcelada, antecipação, estorno, baixa, conciliação).
9. Valores em `transactions` são sempre > 0 (direção vem de `kind`). Valores em `invoice_items` são assinados (crédito/estorno < 0).
10. Constraints do banco são a última linha de defesa, não a validação: valide com Zod e regras de domínio antes, com mensagens em pt-BR.

## Fórmulas canônicas

Implementações de referência em SQL em `tests/acceptance/card-ledger.test.ts` — o código de produção deve produzir os mesmos números.

- **Saldo da conta** = `opening_balance` + Σ entradas − Σ saídas, só `status = POSTED`, não deletadas.
- **Limite disponível** = `limit_total` − Σ invoice_items `ACTIVE` do cartão (todas as faturas) + Σ `INVOICE_PAYMENT` POSTED do cartão. `limit_total` NULL → limite não rastreado (cartão adicional de terceiro). Pode ficar > limite total (saldo credor).
- **Total da fatura** = Σ invoice_items `ACTIVE` da fatura.
- **Gasto Bruto do mês** (competência) = Σ EXPENSE (conta + cartão) por `transaction_date` − Σ `refund_records.amount` por `refund_date`. Exclui `source = ONBOARDING`.
- **Gasto Mensal do mês** (caixa) = Σ EXPENSE do lado conta (por `due_date`, ou `posted_date` se à vista) + Σ invoice_items ACTIVE das faturas com `due_date` no mês + Σ `ANTICIPATION_PAYMENT` do mês.
- **Projeção de mês futuro** = receitas previstas (templates INCOME) − (templates FIXED + estimativas RECURRING_VARIABLE + invoice_items já agendados nas faturas que vencem no mês). Ocorrências de meses futuros são calculadas em memória, não persistidas.

## Convenções

- Código e identificadores em inglês; **toda UI, mensagens de erro e respostas do bot em pt-BR**.
- Formatação BRL com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`; input de valor aceita "1.234,56", "1234,56" e "1234.56".
- Mobile-first: toda tela deve funcionar em 375px de largura. Ações frequentes (lançar, dar baixa) a no máximo 2 toques da home.
- Server Actions retornam `{ ok: true, data } | { ok: false, error }` — nunca lançam para o cliente.
- Identidade: `createdByUserId` = quem lançou (sessão ou remetente do bot). `beneficiaryUserId` = de quem é o gasto (null = casal).

## Fluxo de trabalho

- **Regra de domínio nova ou alterada → teste primeiro em `src/domain/`**. Para dinheiro, inclua property test (fast-check) do invariante de soma.
- Mudou o schema → `pnpm db:generate`, revise o SQL gerado, nunca edite migração já aplicada.
- Antes de dizer que terminou: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:acceptance` (e `pnpm test:e2e` se mexeu em tela).
- Páginas autenticadas ficam em `src/app/(app)/` (segmento `force-dynamic`): nada ali pode rodar no `next build`.
- Drizzle: não use subconsulta correlacionada dentro de `sql` referenciando a tabela externa (ex.: `invoices.id`) numa query de tabela única: a coluna sai sem qualificação e a soma vira zero em silêncio. Prefira agregações agrupadas (ver `invoiceRows` em `src/db/queries/cards.ts`) e cubra queries de tela com teste de aceitação.
- Ambiguidade de regra financeira → pare e pergunte; não invente comportamento.

## Fora do escopo (v1)

Orçamento/metas por categoria, divisão de gastos entre o casal, conta PJ, investimentos/poupança, áudio no bot, multi-tenant, WhatsApp.
