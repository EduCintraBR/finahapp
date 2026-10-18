# Role & Contexto

Atue como um Staff Software Engineer e Arquiteto de Sistemas especialista em aplicações financeiras (Fintech/Personal Finance).
Seu objetivo é projetar, validar e desenvolver um **Sistema Web de Controle Financeiro Pessoal e Familiar (Casal)**, auto-hospedado (Self-Hosted via Docker), focado em precisão contábil, zero perda de centavos e excelente experiência de uso (UX) tanto no Desktop quanto no Mobile.

O sistema será utilizado exclusivamente por 2 usuários (Marido e Esposa), sem fins comerciais ou multi-tenancy complexo, operando sob o modelo de **"Caixa Único" (conta bancária principal compartilhada)**, mas mantendo o rastreio de **quem realizou cada lançamento**.

---

# 1. Stack Tecnológica Definida

- **Framework Full-Stack:** Next.js (App Router) com TypeScript estrito.
- **Estilização & UI:** Tailwind CSS + shadcn/ui + Lucide Icons + Recharts (ou Tremor) para gráficos.
- **Banco de Dados:** PostgreSQL (uso obrigatório de `NUMERIC(12,2)` ou armazenamento em centavos `INTEGER`/`BIGINT` para evitar erros de ponto flutuante IEEE 754).
- **ORM:** Prisma ORM ou Drizzle ORM.
- **Autenticação:** Auth.js (NextAuth) simples ou JWT com 2 usuários pré-cadastrados via Seed (Marido e Esposa).
- **Integrações de Entrada:**
  1. **Bot do Telegram (ou WhatsApp via webhook):** Recebe texto/áudio (ex: "Mercado 180 no crédito Itaú em 2x"), interpreta via LLM/Regex e salva no banco identificando quem enviou pelo ID do remetente.
  2. **Importador OFX / CSV:** Upload de extratos bancários e faturas com motor de conciliação (evita duplicar lançamentos já feitos manualmente ou via Bot).
- **Infraestrutura:** `docker-compose.yml` contendo a aplicação Next.js e o banco PostgreSQL, pronto para execução local e futuro deploy em VPS Linux.

---

# 2. Regras de Negócio e Domínio Financeiro

## 2.1. Modelo de Casal e Conta Única

1. **Visão Unificada com Auditoria:** Todos os dados são visíveis em um único painel para ambos. Cada transação possui o campo `createdByUserId` (identificando se foi lançada por Ele ou por Ela), permitindo filtros por pessoa.
2. **Conta Bancária Principal:** Existe uma única conta principal que reflete o saldo real disponível (Caixa). Entradas (salários, rendas extras) somam ao saldo; saídas à vista (Pix, Débito, Dinheiro, Pagamento de Fatura de Cartão e Contas Fixas/Recorrentes baixadas) abatem do saldo.

## 2.2. Motor de Cartão de Crédito (Regras Críticas)

1. **Unificação de Cartões Virtuais:** Não há separação de limite para cartões virtuais ou adicionais do mesmo cartão titular. Todo lançamento em cartão virtual aponta para o `CreditCard` principal correspondente, debitando do mesmo limite e caindo na mesma fatura. Diferenciação ocorre apenas entre cartões de crédito distintos (ex: Cartão Banco A vs. Cartão Banco B).
2. **Cálculo de Fechamento de Fatura:**
   - Cada cartão possui `limitTotal` (Limite Total), `closingDay` (Dia de Fechamento) e `dueDay` (Dia de Vencimento).
   - Compras feitas antes do `closingDay` entram na fatura do mês corrente; compras feitas no `closingDay` ou após entram na fatura do mês seguinte.
3. **Gestão de Limite Disponível:**
   - Em compras à vista ou parceladas no crédito, o **valor total da compra** compromete o limite do cartão imediatamente.
   - Fórmula: `Limite Disponível = Limite Total - Soma(Parcelas/Lançamentos em faturas ABERTAS ou FUTURAS)`.
   - À medida que a fatura de um mês é marcada como **PAGA** (ou parcelas são antecipadas), o valor correspondente daquelas parcelas é liberado de volta para o Limite Disponível.
4. **Antecipação Manual de Parcelas:**
   - O usuário pode selecionar uma compra parcelada ativa e registrar uma **Antecipação**.
   - Campos preenchidos manualmente pelo usuário:
     - Data em que realizou a antecipação/pagamento.
     - Quantidade de parcelas antecipadas (e quais parcelas específicas, ex: as últimas 4 parcelas).
     - Valor bruto original dessas parcelas vs. Valor do Desconto obtido vs. Valor efetivamente pago.
   - Efeito no sistema: As parcelas originais futuras são marcadas como `ANTICIPATED` (liberando o limite total original delas no cartão), e o valor líquido com desconto é alocado na fatura atual (ou abatido diretamente caso tenha sido pago avulso).
5. **Estornos e Reembolsos Manuais (2 Modos de Operação):**
   Quando ocorrer um reembolso/estorno de compra no cartão, o usuário informará manualmente a data em que o reembolso veio, o valor e escolherá **como o banco processou**:
   - **Modo A — Crédito Total na Fatura Mantendo Parcelas:** O banco lança um crédito único (valor negativo na fatura escolhida) abatendo o saldo daquela fatura, mas mantém as parcelas originais rodando normalmente mês a mês até o fim.
   - **Modo B — Eliminação/Cancelamento da Compra e Parcelas:** O sistema cancela as parcelas futuras pendentes (liberando o limite imediatamente) e, caso alguma parcela já tenha sido paga anteriormente, gera um crédito de ajuste na fatura selecionada pelo usuário.

## 2.3. Dupla Visão de Relatórios (Competência vs. Caixa)

O sistema deve permitir alternar (ou exibir lado a lado) duas visões financeiras fundamentais:

1. **Visão de Gasto Bruto (Regime de Competência / Gasto Verdadeiro):**
   - Considera o **valor total da compra no ato em que ela foi feita**, independentemente do parcelamento.
   - Exemplo: Uma compra de R$ 1.200 em 12x feita em Outubro aparece como R$ 1.200 de gasto no relatório Bruto de Outubro, e R$ 0 nos meses seguintes. Serve para medir o impulso de consumo real naquele mês.
2. **Visão de Gasto Mensal (Regime de Caixa / Comprometimento Mensal):**
   - Considera apenas o que **efetivamente precisa ser pago naquele mês** (Gastos à vista em Pix/Débito/Dinheiro + Gastos Fixos/Recorrentes do mês + Soma das parcelas e lançamentos da fatura que vence naquele mês).
   - Exemplo: Na compra de R$ 1.200 em 12x, esta visão exibe apenas R$ 100 em cada um dos 12 meses.

## 2.4. Gastos Fixos, Gastos Recorrentes e Projeção Futura

1. **Diferenciação Conceitual:**
   - **Gasto Fixo (`FIXED`):** Despesa contínua com valor exato previsível todo mês (ex: Aluguel, Internet, Assinaturas/Streaming).
   - **Gasto Recorrente (`RECURRING_VARIABLE`):** Despesa que ocorre todo mês com dia de vencimento previsto, mas cujo valor varia (ex: Conta de Energia, Água, Gás, Mercado). Possui um `estimatedAmount` (valor estimado/média) para projeção e um `actualAmount` preenchido no momento do pagamento.
2. **Projeção de Meses Futuros:**
   - O usuário pode navegar livremente para qualquer mês futuro (ex: daqui a 6 ou 12 meses) e visualizar a projeção completa:
     `Entradas Previstas - (Gastos Fixos + Estimativa de Gastos Recorrentes + Parcelas de Cartão já agendadas para aquele mês)`.
3. **Status Pendente e Baixa Manual:**
   - Nenhum gasto fixo, recorrente ou fatura de cartão debita do saldo bancário sozinho no dia do vencimento.
   - Todos nascem no mês com status `PENDING` (gerando destaque visual de "Vence Hoje", "Próximo do Vencimento" ou "Atrasado").
   - O abatimento no saldo só ocorre quando o usuário clica em **"Confirmar Pagamento"**, informando a data real do pagamento e ajustando o valor final (caso tenha variado).

## 2.5. Canais de Entrada: Bot + Importação OFX/CSV com Conciliação

1. **Bot de Lançamento Rápido (Telegram Webhook):**
   - Endpoint de API `/api/webhooks/bot` que recebe mensagens dos IDs autorizados do Marido e da Esposa.
   - Interpreta linguagem natural para criar transações à vista ou parceladas no cartão, respondendo com um resumo de confirmação e o novo saldo/limite disponível.
2. **Importador OFX e CSV Inteligente:**
   - Permite subir o extrato da conta corrente (OFX/CSV) ou fatura do cartão (CSV/OFX).
   - **Motor de Conciliação (Deduplicação):** Antes de inserir uma linha do arquivo importado, o sistema busca transações existentes com data próxima (±3 dias) e mesmo valor exato. Se encontrar um lançamento já feito manualmente ou via Bot, sugere o "Match" (vínculo) em vez de duplicar o gasto.

---

# 3. Estrutura do Dashboard Principal (Visão em 5 Segundos)

Na tela inicial (Home), com seletor de Mês/Ano no topo, exibir imediatamente:

1. **KPI 1 — Balanço e Saldo Atual:**
   - Saldo Atual em Conta (Caixa real hoje).
   - Total de Entradas (Receitas) do mês vs. Total de Saídas já pagas e pendentes no mês + Projeção de Saldo Final do Mês.
2. **KPI 2 — Gasto Total do Mês (Dupla Visão):**
   - Card comparativo mostrando lado a lado: **Gasto Mensal (O que pagar este mês)** vs. **Gasto Bruto (Total comprado este mês incluindo valor cheio de parcelamentos)**.
3. **KPI 3 — Painel de Cartões de Crédito:**
   - Lista de cards para cada cartão mostrando: Nome do Cartão, Valor da Fatura Atual, Status da Fatura (Aberta/Fechada/Paga), Barra visual de Limite (Limite Total, Limite Comprometido em parcelas e **Limite Disponível Real**), e contador de quantas compras parceladas estão ativas naquele cartão e quando termina a última.
4. **Seção Operacional Abaixo da Dobra:**
   - Lista de Contas Fixas e Recorrentes pendentes do mês (com botão de baixa rápida).
   - Últimas transações lançadas (com badge de quem lançou: Marido/Esposa, categoria e método de pagamento).

---

# 4. O que eu espero da sua resposta agora

Antes de gerar qualquer código de interface, faça o seguinte:

1. **Valide a Arquitetura:** Aponte se há algum gargalo ou melhoria na modelagem acima.
2. **Gere o Schema Completo do Banco de Dados (Prisma ou Drizzle):** Escreva o schema completo contemplando Users, BankAccount, Categories, CreditCards, Invoices, Transactions, InstallmentPlans (grupos de parcelamento), AnticipationRecords, RefundRecords e RecurringTemplates.
3. **Proponha o Plano de Implementação em Fases (Roadmap Técnico):** Divida a construção em etapas lógicas (Fase 1: Setup Docker + DB + Auth; Fase 2: Motor de Conta, Fixos e Recorrentes; Fase 3: Motor de Cartões, Faturas, Antecipação e Reembolso; Fase 4: Dashboards e Relatórios Competência/Caixa; Fase 5: Importador OFX/CSV e Bot).
