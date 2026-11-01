# Finah — Plano de reestruturação da UI (mobile primeiro)

Auditoria feita em 31/10/2026: as 28 telas em 375×812 (celular) e 1280×800 (desktop), mais os fluxos de login com 2FA, "Paguei", filtros, compra no cartão e "Pagar fatura", com dados fictícios de 3 meses. Nenhuma tela quebrou nem rola para o lado; o problema é de **organização, densidade e acabamento**, principalmente no celular (PWA).

Cada fase termina com o app utilizável. Marque os itens à medida que forem concluídos.

---

## Decisões (31/10/2026)

| #   | Tema               | Decisão                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Navegação inferior | **Início · Lançamentos · (+) · Relatórios · Mais.** Cartões vai para o "Mais", junto com Fixos, Empréstimos, Benefícios, Importar extrato, Conferir saldo e Ajustes. No desktop a sidebar mostra todas as seções.                                                                                                                   |
| U2  | Botão (+)          | Abre um **painel inferior** para escolher o tipo: Despesa, Receita, Compra no cartão, Gasto no benefício. Cada opção abre o formulário já no tipo certo (2 toques, dentro da regra da SPEC).                                                                                                                                        |
| U3  | Início sem rolar   | Na primeira tela do celular: seletor de mês, "Olá, Eduardo", o mês, **Saldo atual**, **previsão do fim do mês**, **Entrou** e **Saiu**, e logo abaixo os **pendentes**: previsto entrar (A receber) e previsto sair (A pagar). Gastos do mês, cartões, benefícios, empréstimos e últimos lançamentos ficam abaixo, na rolagem.      |
| U4  | "Saiu" × "Saídas"  | **Saiu** = tudo o que já foi pago no mês (despesas, pagamentos de fatura e antecipações; D68). **Saídas** = Saiu + o que ainda vai sair (pendente, atrasado e agendado), que é a regra D38. Hoje a tela de Lançamentos chama de "Saídas" só as despesas pagas, sem pagamento de fatura e sem pendentes: isso é corrigido na Fase E. |
| U4a | Atrasados          | Conta, receita prevista ou fatura atrasada **acompanha os meses seguintes** no A pagar / A receber (e nas Saídas) até ser paga ou recebida; aí sai de todos eles e entra no Saiu/Entrou do mês do pagamento (SPEC D72, feito na Fase C).                                                                                            |

---

## Diagnóstico (o que corrigir em todo o app)

1. **Navegação escondida:** Fixos, Empréstimos, Importar e Conferir são 4 ícones sem rótulo no topo de Lançamentos; Benefícios fica dentro de Cartões; Empréstimos e Benefícios não estão na sidebar.
2. **Seletor de mês em toda tela**, inclusive formulários, detalhes, Ajustes, Empréstimos e Projeção, onde ele não faz nada.
3. **Card dentro de card (padding duplo):** sobram ~300px úteis em 375px e o texto é cortado ("Empréstimo cons…", "Nubank Ul…", "Alimentação R$ 2.632,78 · R…", "Recorrentes (…", campo de mês "outubro de 2", filtros "Receitas e desp").
4. **Linhas de lista poluídas:** bolinha "E" em toda linha, selo "Pago" no caso normal, "Pendente" + "Vencida" juntos, receita marcada "Vencida", e na fatura um grupo por dia cujo subtotal repete o único item.
5. **Ações em `<details>`** (15 ocorrências) com o triângulo nativo: Antecipar, Estorno, Editar compra, Editar cartão, Datas da fatura, Trocar senha…
6. **Detalhe = leitura + formulário de edição sempre aberto** (lançamento, fixo) e "Excluir" vermelho cheio como 2ª ação.
7. **Diálogos centralizados** em vez de painel inferior; no PWA do iPhone o teclado empurra o diálogo.
8. **Formulários:** botão principal abaixo da dobra e atrás da barra inferior; `<select>` e `type=month` nativos; input de arquivo "Choose File".
9. **Início com ~3.400px** (8 seções).
10. **Desktop com larguras diferentes** por tela (lista 100%, detalhe 670px, formulário 510px); lista de lançamentos sem colunas; coluna direita da Início estreita, cortando nomes.

---

## Fase A — Base de componentes e captura visual

> Ajuste de execução (31/10/2026): cada componente nasce junto com a primeira tela que o usa, para não ficar código sem uso. Os que não entraram nas Fases A/B foram para a fase indicada.

- [x] `PageHeader` (`src/components/layout/page-header.tsx`): voltar, título, subtítulo e ações — usado no Mais e em Lançamentos; as outras telas migram nas Fases D/E
- [x] Painel inferior: o próprio `Dialog` (`src/components/ui/dialog.tsx`) virou painel que sobe de baixo no celular (com `safe-area`) e continua janela no desktop, sem dependência nova — "Paguei", "Pagar fatura" etc. já usam
- [x] Script versionado `pnpm ui:shots [nome] [filtro]` (`scripts/ui-shots.ts`): banco fictício separado `finah_shots` com dados relativos a hoje + capturas 375/1280 de todas as rotas e do (+), "Paguei" e filtros, em `tmp/ui-shots/<nome>/`
- [x] `ListRow` padrão: título, linha secundária, valor à direita; status só quando é exceção (pendente, atrasada, agendado, pago antes); quem lançou como texto discreto, não bolinha (Fase E1: `EntryRowItem`)
- [x] `StickyActions` (`src/components/forms/sticky-actions.tsx`): no novo lançamento (Fase D); os outros formulários adotam na Fase E
- [x] `CategoryPicker` (grade com ícone + busca) no novo lançamento (Fase D)
- [ ] `Select` próprio, `CategoryPicker` nos outros formulários (fixo, compra parcelada, importação), `MonthField` próprio (troca o `type=month`), `FilePicker` em pt-BR → **Fase E**
- [x] `FilterChips` (filtros em botões, abrindo um painel inferior com as opções) — Fase E1: `FilterChip` em Lançamentos
- [ ] Regra de layout: uma só largura máxima por tipo de tela (lista, detalhe, formulário) e sem card dentro de card no celular → **Fase E/F**
- [x] Confirmações (`AlertDialog`) também como painel inferior no celular (Fase D)

**Pronto quando:** o script de capturas roda com um comando. ✅ 31/10/2026

---

## Fase B — Navegação e shell (U1, U2)

- [x] Barra inferior: Início · Lançamentos · (+) · Relatórios · Mais
- [x] Tela "Mais" (`/mais`): Cartões, Benefícios, Fixos e recorrentes, Empréstimos, Importar extrato, Conferir saldo, Ajustes; a aba Mais fica acesa nessas telas
- [x] (+) abre o painel de tipos (Despesa, Receita, Compra no cartão, Gasto no benefício) → `/lancamentos/novo?tipo=…` (também no botão "Novo lançamento" da sidebar)
- [x] Seletor de mês só nas telas que dependem do mês: Início, Lançamentos, Relatórios, Resumo **e também Cartões, cartão e cartão de benefícios** (que usam o mês desde 21/10); formulários, detalhes e configurações não o mostram
- [x] Sidebar do desktop com todas as seções, agrupadas (principal / Planejamento / Conta / Ajustes no rodapé)
- [x] Os 4 ícones sem rótulo do topo de Lançamentos saíram (o destino está no Mais e na sidebar) — antecipado da Fase E
- [x] E2E `navegacao.spec.ts` (barra, painel do +, Mais, seletor de mês) e SPEC D71
- [x] Corrigido: escolher outro tipo no (+) já estando no formulário não trocava o formulário

**Pronto quando:** toda seção é alcançável em ≤ 2 toques da Início e nenhuma ação depende de ícone sem rótulo. ✅ 31/10/2026

---

## Fase C — Início (U3)

- [x] Primeira tela em 375×812, sem rolar e acima da barra inferior: seletor de mês, "Olá, Eduardo" + o mês, **Saldo atual + previsão do fim do mês**, e uma grade 2×2 com as entradas à esquerda e as saídas à direita: **Entrou / Saiu** (já aconteceu) e **A receber / A pagar** (previsto entrar / sair, com os atrasados, D72)
- [x] Pendentes logo abaixo: nome inteiro na linha, valor e vencimento embaixo ("Venceu 10/10" em vermelho, vale para conta e receita; "Vence hoje"), até 3 itens e "Ver todos os N pendentes" abre o resto no lugar (`ShowMoreList`); "Paguei/Recebi" já abre o painel inferior (Fase A)
- [x] Na rolagem: Gastos do mês, Cartões (faixa horizontal no celular, um cartão por vez com o próximo aparecendo na borda; lista na coluna do desktop), Benefícios, Empréstimos, Últimos lançamentos. Nomes de cartão, benefício e empréstimo quebram a linha em vez de serem cortados
- [x] Desktop: 2 colunas com a lateral de largura fixa (22rem; 24rem a partir de 1280px), sem nomes cortados
- [x] E2E `inicio.spec.ts`: saldo, previsão, Entrou, Saiu, A receber e A pagar visíveis sem rolar e acima da barra; pendentes com até 3 e "Ver todos". Helper `homePending` para os testes que dão baixa pela Início
- [x] Regra U4a (SPEC D72): atrasados acompanham os meses seguintes no A pagar / A receber, no detalhe `/resumo`, na lista de pendentes e no bot, com teste de domínio e de aceitação
- [ ] `ListRow` nos "Últimos lançamentos" (bolinha "E" e selo "Pago" ainda aparecem) → **Fase E**, junto com a lista de Lançamentos, que usa o mesmo componente

**Pronto quando:** os números de U3 aparecem sem rolar no celular e continuam batendo com o Resumo e os Relatórios (`fase4.spec.ts`). ✅ 31/10/2026

---

## Fase D — Ações frequentes

- [x] Novo lançamento: valor grande no topo (máscara de centavos, teclado numérico), categoria em **grade de ícones num painel com busca sem acento** (`CategoryPicker`), observação recolhida em "+ Adicionar observação", sem card em volta no celular; "Lançar" sempre à vista (`StickyActions`: acima da barra inferior e, com o teclado aberto, acima do teclado). Na edição continua o botão comum (a tela de detalhe é revista na Fase E)
- [x] Teclado do iPhone: `useKeyboardInset` (via `visualViewport`, função pura testada) sobe a barra de ações e os painéis (`Dialog`, `AlertDialog`) pela altura do teclado
- [x] "Paguei", "Recebi" e "Pagar fatura" já eram painel (Fase A); **"Pagar parcelas"** do empréstimo saiu do bloco aberto na página e virou painel
- [x] Confirmação (`AlertDialog`) também é painel inferior no celular; no `ActionButton`, o gatilho de ação destrutiva é contorno com texto vermelho e o vermelho cheio fica só dentro da confirmação
- [x] `pnpm ui:shots` captura também o painel de categorias, "Pagar parcelas" e a confirmação de exclusão; o filtro vale para essas interações
- [x] E2E `acoes.spec.ts` (formulário inteiro e "Lançar" na 1ª tela; grade de categorias com busca; aviso sem categoria); helpers `pickCategory`/`categoryOffered` (select ou grade) nos testes
- [ ] Confirmar num iPhone real que o teclado não cobre "Lançar" nem "Confirmar" → **Fase G** (aparelhos reais)

**Pronto quando:** lançar uma despesa em 375×812 não exige rolar, e o teclado do iPhone não cobre o botão. ✅ 31/10/2026 (no navegador; aparelho real na Fase G)

---

## Fase E — Listas e detalhes

> Ajuste de execução (01/11/2026): dividida em 4 PRs, um por grupo de telas (E1 Lançamentos, E2 cartões, E3 detalhes/empréstimo/fixos, E4 o resto).

### E1 — Lançamentos

- [x] Resumo do topo com **Entrou, Saiu, A receber, A pagar** (os mesmos números e links da Início, `MonthKpis`) e **Saídas do mês** (U4: `outTotalCents` = Saiu + A pagar, com os atrasados). Antes somava só `EXPENSE` pagas da lista filtrada; agora é sempre o mês inteiro, com aviso quando há filtro
- [x] Busca + **filtros em botões** (`FilterChip`: Tipo, Situação, Categoria, Meio, De quem é, Quem lançou) que abrem um painel com as opções em links; "Limpar filtros"
- [x] Linhas `ListRow` (`EntryRowItem`): ícone da categoria no lugar da bolinha "E"; categoria · meio · de quem e "lançado por" só quando foi a outra pessoa; status só como exceção (Pendente + "Venceu dd/mm"/"Vence hoje", Agendado para dd/mm, Pago antes, Antecipado, Cancelado), sem selo "Pago"; nada cortado além da descrição. Vale também nos "Últimos lançamentos" da Início
- [x] Cabeçalho de data preso no topo ao rolar
- [x] D72 no extrato: os pendentes atrasados de meses anteriores aparecem no topo, em "De meses anteriores · sem baixa" (`listEntries` com `overdueAsOf`)
- [x] "Em atraso" no lugar de "Vencida" (vale para conta e receita)
- [x] E2E `lancamentos.spec.ts`; aceitação de `outTotalCents` e do extrato com atrasados

### E2 — Cartões

- [x] Fatura: cabeçalho com o total e, lado a lado, **Pago** e **Falta pagar** (ou "Pago a mais"), com "Pagar fatura" logo abaixo; itens com ícone da categoria e o **"2/3" sempre à vista** (mesmo com a descrição cortada); "lançado por" só quando foi a outra pessoa; subtotal do dia só quando há mais de um item no dia; "O banco mudou as datas?" num painel
- [x] Cartão: **faixa horizontal de faturas** (passadas ← atual → futuras), aberta já centrada na atual (ou no mês escolhido), com a atual em destaque; ações em barra ("Nova compra" cheia; "Parcelamento em andamento" e "Importar fatura (OFX)" lado a lado); "Editar cartão" num painel (salvar fica na tela e fecha o painel)
- [x] Compra parcelada: parcelas em **linha do tempo** (paga / fatura fechada a pagar / atual / futura); **Antecipar, Estorno e Editar** como botões que abrem painel; Excluir dentro do Editar, com confirmação
- [x] `SheetAction` + `useActionDone` (o painel fecha quando a ação dá certo) e `Toaster` próprio (aviso no rodapé, sem dependência nova por causa da CSP); `ScrollStrip` (faixa centrada no item atual)

### E3 — Detalhes, empréstimo e fixos

- [ ] Empréstimo: uma lista só de parcelas, com seleção para pagar
- [ ] Fixos: total por grupo (contas a pagar, receitas previstas)
- [ ] Detalhe de lançamento e de fixo: só leitura + botão "Editar" (abre formulário) + menu "⋯" com Excluir; "Encerrar" do fixo sem vermelho cheio fora da confirmação

### E4 — Restante

- [ ] Benefícios, Projeção, Ajustes e Categorias revisados com os mesmos componentes (sem cortes de texto)
- [ ] `CategoryPicker` nos outros formulários, `StickyActions` nos outros formulários, `MonthField`, `FilePicker` em pt-BR

**Pronto quando:** nenhum texto relevante é cortado em 375px e não sobra nenhum `<details>` para ação principal.

---

## Fase F — Desktop

- [ ] Lançamentos em tabela (data, descrição, categoria, meio, quem, status, valor) com filtros em barra lateral
- [ ] Larguras máximas padronizadas por tipo de tela; detalhes em 2 colunas quando couber
- [ ] Relatórios: barras de categoria com largura limitada

**Pronto quando:** as capturas em 1280px não têm espaços vazios largos nem valores longe do nome.

---

## Fase G — Acabamento do PWA

- [ ] `main` com espaço inferior = barra + `env(safe-area-inset-bottom)`; nada atrás da barra
- [ ] Campos com fonte ≥ 16px no celular (evita o zoom do iOS); `overscroll-behavior` na página
- [ ] Revisar o tema claro em todas as telas
- [ ] Revisar a tela de revisão de importação (`/importacoes/[id]`), que ficou fora da auditoria por falta de lote
- [ ] Avisos de hidratação no `next dev` (aparecem no log do E2E, sem falhar teste): links da navegação com `?mes=` renderizados sem o mês no servidor, e `aria-hidden` da sidebar quando um diálogo abre antes da hidratação
- [ ] Teste num iPhone e num Android reais com o PWA instalado (dev.finahapp.com)

**Pronto quando:** o PWA instalado no iPhone e no Android passa pelos fluxos de lançar, dar baixa e pagar fatura sem nenhum elemento coberto ou cortado.
