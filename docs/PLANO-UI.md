# Finah — Plano de reestruturação da UI (mobile primeiro)

Auditoria feita em 31/10/2026: as 28 telas em 375×812 (celular) e 1280×800 (desktop), mais os fluxos de login com 2FA, "Paguei", filtros, compra no cartão e "Pagar fatura", com dados fictícios de 3 meses. Nenhuma tela quebrou nem rola para o lado; o problema é de **organização, densidade e acabamento**, principalmente no celular (PWA).

Cada fase termina com o app utilizável. Marque os itens à medida que forem concluídos.

---

## Decisões (31/10/2026)

| #   | Tema               | Decisão                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U1  | Navegação inferior | **Início · Lançamentos · (+) · Relatórios · Mais.** Cartões vai para o "Mais", junto com Fixos, Empréstimos, Benefícios, Importar extrato, Conferir saldo e Ajustes. No desktop a sidebar mostra todas as seções.                                                                                                                                                                                      |
| U2  | Botão (+)          | Abre um **painel inferior** para escolher o tipo: Despesa, Receita, Compra no cartão, Gasto no benefício. Cada opção abre o formulário já no tipo certo (2 toques, dentro da regra da SPEC).                                                                                                                                                                                                           |
| U3  | Início sem rolar   | Na primeira tela do celular: seletor de mês, "Olá, Eduardo", o mês, **Saldo atual**, **previsão do fim do mês**, **Entrou** e **Saiu**, e logo abaixo os **pendentes**: previsto entrar (A receber) e previsto sair (A pagar). Gastos do mês, cartões, benefícios, empréstimos e últimos lançamentos ficam abaixo, na rolagem.                                                                         |
| U4  | "Saiu" × "Saídas"  | **Saiu** = tudo o que já foi pago no mês (despesas, pagamentos de fatura e antecipações; D68). **Saídas** = Saiu + o que ainda vai sair (pendente, atrasado e agendado), que é a regra D38. Hoje a tela de Lançamentos chama de "Saídas" só as despesas pagas, sem pagamento de fatura e sem pendentes: isso é corrigido na Fase 4. Ver pergunta em aberto abaixo sobre atrasados de meses anteriores. |

### Em aberto

- **U4a:** Os atrasados de **meses anteriores** entram nas "Saídas" do mês escolhido? Pela D38 hoje, as saídas pendentes contam só o que vence no mês, e os atrasados antigos entram só no saldo projetado.

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
- [ ] `ListRow` padrão: título, linha secundária, valor à direita; status só quando é exceção (pendente, atrasada, agendado, pago antes); quem lançou como texto discreto, não bolinha → **Fase C/E**
- [ ] `StickyActions`: barra fixa no rodapé dos formulários, acima da navegação inferior e do indicador do iPhone → **Fase D**
- [ ] `Select` e `CategoryPicker` próprios (categorias em grade com ícone + busca), `MonthField` próprio (troca o `type=month`), `FilePicker` em pt-BR → **Fase D/E**
- [ ] `FilterChips` (filtros em botões, abrindo um painel inferior com as opções) → **Fase E**
- [ ] Regra de layout: uma só largura máxima por tipo de tela (lista, detalhe, formulário) e sem card dentro de card no celular → **Fase E/F**
- [ ] Confirmações (`AlertDialog`) também como painel inferior no celular → **Fase D**

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

- [ ] Primeira tela em 375×~700: seletor de mês, "Olá, Eduardo · Outubro de 2026", Saldo atual + previsão do fim do mês, Entrou / Saiu, A receber / A pagar (previsto entrar / sair)
- [ ] Lista de pendentes logo abaixo, com até 3 itens + "Ver todos"; "Paguei/Recebi" abre `ResponsiveSheet`
- [ ] Na rolagem: Gastos do mês (Mensal × Bruto + rosca), Cartões (faixa horizontal compacta), Benefícios, Empréstimos, Últimos lançamentos
- [ ] Desktop: grade de 2 colunas sem cortar nomes (coluna lateral com largura mínima)
- [ ] E2E: na Início em 375×812, Saldo, Entrou, Saiu, A receber e A pagar visíveis sem rolar

**Pronto quando:** os números de U3 aparecem sem rolar no celular e continuam batendo com o Resumo e os Relatórios (`fase4.spec.ts`).

---

## Fase D — Ações frequentes

- [ ] Novo lançamento: valor grande no topo (`inputmode="decimal"`), categoria por grade de ícones, "Lançar" sempre visível (`StickyActions`)
- [ ] "Paguei", "Recebi", "Pagar fatura", "Pagar parcelas" em painel inferior
- [ ] Confirmação de exclusão em painel, com o botão destrutivo só dentro dela

**Pronto quando:** lançar uma despesa em 375×812 não exige rolar, e o teclado do iPhone não cobre o botão.

---

## Fase E — Listas e detalhes

- [ ] Lançamentos: busca + filtros em botões, linhas `ListRow`, cabeçalho de data fixo ao rolar; resumo do topo com **Entrou, Saiu, Saídas (U4), A receber, A pagar** usando as queries canônicas (corrigir o cálculo atual, que soma só `EXPENSE` pagas)
- [ ] Fatura: cabeçalho com total, pago e quanto falta; itens com "2/3" sempre visível; agrupamento por dia só quando há mais de um item no dia
- [ ] Cartão: seletor horizontal de faturas (passadas ← atual → futuras) com a atual em destaque; ações (Nova compra, Parcelamento em andamento, Importar) em menu ou barra
- [ ] Compra parcelada: parcelas em linha do tempo (paga / atual / futura); Antecipar, Estorno e Editar como botões que abrem painel, não `<details>`
- [ ] Empréstimo: uma lista só de parcelas, com seleção para pagar
- [ ] Fixos: total por grupo (contas a pagar, receitas previstas)
- [ ] Detalhe de lançamento e de fixo: só leitura + botão "Editar" (abre formulário) + menu "⋯" com Excluir
- [ ] Receita não recebida aparece como "Atrasada", não "Vencida"
- [ ] Benefícios, Projeção, Ajustes e Categorias revisados com os mesmos componentes (sem cortes de texto)

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
- [ ] Teste num iPhone e num Android reais com o PWA instalado (dev.finahapp.com)

**Pronto quando:** o PWA instalado no iPhone e no Android passa pelos fluxos de lançar, dar baixa e pagar fatura sem nenhum elemento coberto ou cortado.
