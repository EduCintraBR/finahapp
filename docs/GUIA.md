# Finah — guia de uso e operação

Controle financeiro do casal: conta principal compartilhada, cartões de crédito, PWA e bot do Telegram.
Regras de negócio em [docs/SPEC.md](SPEC.md), fases em [docs/ROADMAP.md](ROADMAP.md), convenções de código em [CLAUDE.md](../CLAUDE.md).

## Desenvolvimento

Requisitos: Node 24+, pnpm (via `corepack enable`) e Docker (para o Postgres).

```bash
cp .env.example .env          # preencha POSTGRES_PASSWORD, DATABASE_URL, AUTH_SECRET e os SEED_*
docker compose up -d db       # só o Postgres, em 127.0.0.1:5432
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev                      # http://localhost:3000
```

Armadilhas comuns no `.env` (o seed e o login falham sem uma mensagem clara):

- **`$` em valores**: o Docker Compose e o Next apagam o trecho `$ALGO`. Senhas de login com `$` vão entre aspas simples (`'...'`); a senha do Postgres deve ter só letras e números.
- **`SEED_USER*_TELEGRAM_ID`** é o ID numérico (pegue com o @userinfobot), não o `@usuario`. Pode ficar vazio.
- **`AUTH_URL`** precisa de `https://` e só é usado na VPS; em dev, deixe comentado.
- Mudou `POSTGRES_PASSWORD` depois do primeiro `docker compose up`? O Postgres guarda a senha antiga no volume. Troque com `ALTER USER` ou, se o banco estiver vazio, recrie o volume (`docker compose down` + `docker volume rm finah_pgdata`).

Antes de considerar uma tarefa pronta: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:acceptance`.

Testes de navegador (Playwright, tela de celular): `docker compose up -d db` e depois `pnpm test:e2e`. Eles usam um banco à parte (`finah_e2e`), recriado a cada execução, e nunca tocam nos seus dados. Na primeira vez: `pnpm exec playwright install chromium`.

## Usando o app

- **Lançar** (botão **+**): despesa ou receita à vista na conta, com categoria, meio de pagamento e de quem é (casal ou uma pessoa). Datas anteriores ao início do controle são recusadas.
- **Lançamentos**: extrato do mês com entradas, saídas, a pagar e a receber, e filtros por tipo, situação, categoria, meio, quem lançou e de quem é. Toque num lançamento para editar ou excluir. Nada é apagado de verdade: fica no histórico de auditoria.
- **Fixos e recorrentes** (atalho em Lançamentos): contas que se repetem todo mês, como aluguel (fixo) ou luz (recorrente, valor estimado), e receitas previstas, como o salário. O app cria cada mês como **pendente** no dia do vencimento (o dia 31 vira o último dia do mês). "Alterar a partir de" serve para reajustes; "Encerrar" para quando a conta acaba.
- **Categorias** (Ajustes → Categorias): crie categorias novas (despesa ou receita), renomeie, ajuste os **apelidos** que o bot e a importação usam para reconhecer a categoria (ex.: "luz, energia, água") e arquive as que não usa mais. Arquivar não apaga nada: a categoria some das listas de escolha, mas os lançamentos antigos e os relatórios continuam com ela, e você pode restaurá-la quando quiser. A tela mostra quantos lançamentos usam cada categoria. "A classificar" e "Outras receitas" não podem ser renomeadas nem arquivadas, porque o bot e as importações usam como reserva.
- **Home**: saldo atual; **caixa do mês** (o que entrou, saiu, falta receber e falta pagar, e o saldo previsto para o fim do mês); pendentes; **gasto do mês** em Mensal (o que sai da conta no mês, com as faturas que vencem nele) e Bruto (o que foi comprado no mês), com a economia das antecipações; cartões; últimos lançamentos. Os números são os mesmos dos relatórios.
- **Relatórios**: gasto por categoria em **Mensal** ou **Bruto** (alterne no topo), com filtros de de quem é, quem lançou, cartão e meio de pagamento, e a evolução dos últimos 12 meses (Mensal × Bruto, com tabela). **Projeção** (atalho em Relatórios): resultado e saldo estimado dos próximos meses, com receitas e contas cadastradas, faturas já agendadas e assinaturas; avance de 3 em 3 meses (até 3 anos).
- **Dar baixa**: na Home, em "Pendentes", toque em **Paguei** ou **Recebi** e confirme a data e o valor real (2 toques). Errou? Abra o lançamento e use **Estornar baixa**: ele volta a pendente com o valor estimado.
- **Corrigir o valor de uma compra no cartão**: em Editar, na tela da compra. Só enquanto nenhuma parcela tiver caído em fatura fechada e não houver antecipação ou estorno; depois disso, o valor fica travado.
- **Encerrar ou excluir um fixo**: na tela do fixo, **Encerrar** para de gerar contas depois do mês que você escolher (o histórico fica). **Excluir** apaga o fixo e as contas dele ainda não pagas; as já pagas continuam no extrato e o saldo não muda.
- **Digitar valores**: os campos de valor têm máscara de banco: digite só os números e os centavos entram primeiro (1 → 0,01; 1234 → 12,34; 123456 → 1.234,56), sem precisar da vírgula. Apagar tira o último dígito.
- **Início (dashboard)**: o saldo em destaque com a previsão do fim do mês, os indicadores do mês (entrou, saiu, a receber, a pagar), a pizza dos gastos por categoria, as saídas dos últimos 6 meses, os cartões, as pendências (com **Paguei/Recebi** em 2 toques) e os últimos lançamentos. Tudo segue o mês do seletor no topo: ao voltar um mês, os números, os gastos e as faturas são os daquele mês.
- **Mês nos cartões**: em Cartões, cada cartão mostra a fatura do mês escolhido; se ele não tem fatura nesse mês, aparece zerado com a mensagem "Nenhuma fatura lançada para esse mês neste cartão". No mês atual, o destaque é a fatura aberta e a do mês aparece logo abaixo.
- **Tema claro/escuro**: o padrão é escuro. Use o botão de sol/lua no cabeçalho, ou Ajustes → Aparência (Escuro, Claro ou Sistema). Vale só para o aparelho em que você escolheu.
- **Conferir saldo** (Home → Conferir): informe o saldo que o banco mostra numa data. Se não bater, o app mostra a diferença e, se você quiser, lança um ajuste exato.
- **Importar o extrato da conta (OFX)** (Lançamentos → ícone de importar): no app do Nubank, Conta → Extrato → Exportar → período → OFX. Na revisão, cada linha aparece como **Despesa**, **Receita**, **Transferência** (aplicação/resgate RDB, caixinha e Pix entre as contas do casal: mexem no saldo, mas não contam como gasto nem receita) ou **Pagamento de fatura** (escolha a fatura; serve também para o Pix à titular do adicional). O que já está no app é sugerido com **É esse**; se for uma conta pendente (ex.: aluguel), ela recebe a baixa com a data e o valor do extrato. No alto, o app compara o saldo do app com o do arquivo na data final.
- **Importar meses anteriores ao início do controle**: exporte o extrato do mês antigo (ex.: setembro) e envie em Lançamentos → Importar. Em vez de recusar, o app mostra o que vai mudar: o início do controle recua (ex.: de 01/10 para 01/09) e o saldo inicial dessa data é calculado do próprio arquivo, e confere com o saldo inicial atual. Se bater, é só confirmar. Se não bater (arquivo incompleto ou saldo inicial errado), o app bloqueia e mostra a diferença. Dá para repetir para meses ainda mais antigos, sempre do mais recente para o mais antigo. **Para a fatura do cartão desse mês**: importe antes o extrato da conta do período (ele recua o início sozinho); depois importe a fatura e, no extrato, toque em **Atualizar sugestões** para a linha "Pagamento de fatura" achar o pagamento.
- **CSV em vez de OFX**: o Nubank também exporta CSV. Serve nas mesmas telas. No CSV da fatura, informe o **mês da fatura** (o mês do vencimento). O CSV do extrato não traz o saldo do banco, então o app não consegue conferir o saldo no fim (e, ao recuar o início, avisa que não dá para conferir).
- **Na revisão da importação**: **Trocar** por outro lançamento (lista os de mesmo valor ainda sem par), **ignorar em lote** (marque as linhas e toque em "Ignorar as marcadas"; no cartão adicional, "Ignorar todas menos as marcadas" deixa só as compras do casal) e **Atualizar sugestões**.
- **Saldo inicial** (Ajustes → Conta principal): corrige o saldo de abertura e a data de início do controle, se o valor do começo estiver errado. Fica registrado no histórico; a data não pode passar de um lançamento já existente.

### Cartões

- **Cadastrar** (Cartões → **+ Cartão**): informe o dia de vencimento; o fechamento é sugerido como 7 dias antes (padrão do Nubank) e pode ser ajustado. Para o adicional da sua mãe, marque **Cartão adicional**, informe a titular e deixe o limite em branco (o app mostra só o comprometido). Os apelidos servem para o bot reconhecer o cartão ("nubank", "roxinho").
- **Empréstimo** (Lançamentos → ícone de banco, ou Fixos → Empréstimos): informe o **valor que recebeu**, o **total a pagar já com juros**, o número de parcelas e o vencimento da 1ª. O dinheiro entra no saldo da conta (sem contar como receita) e o app divide o total em parcelas mensais, que viram contas a pagar nos meses certos e entram na projeção. Em **Pagar parcelas** escolha uma ou várias (por exemplo, as últimas), informe **quanto pagou** e **quando**: o app mostra o desconto (soma das parcelas − o que você pagou) ou o acréscimo, e a parcela passa a contar como saída no mês do pagamento. A tela do empréstimo mostra o que falta, o que já foi pago, a economia e quantos dias cada parcela foi adiantada ou atrasada. Também dá para usar "Paguei" nas parcelas em Lançamentos. Errou antes de pagar qualquer parcela? Exclua o empréstimo. Depois do primeiro pagamento, só desfazendo o pagamento da parcela.
- **Cartão de benefícios** (multibenefícios, vale-refeição): em Cartões → **+ Benefício**. Informe o nome, quando o crédito cai (último dia útil, ou um dia fixo) e as **carteiras**: para cada uma, o crédito mensal (ex.: 1.500,00 e 704,00) e o saldo que ela tem hoje. Todo mês o app credita sozinho, como receita, e o saldo de cada carteira aparece no cartão e na Home. O dinheiro não passa pela conta: **o Saldo atual não muda**, mas os gastos entram nos relatórios (filtro "Cartão de benefícios"). Para gastar: botão **+** → aba **Benefício** (escolhe a carteira; sem saldo suficiente o app não deixa). Errou um gasto? Exclua no histórico do cartão e lance de novo. **Encerrar** (no cartão): escolha o último mês com crédito; depois dele o app não credita mais, e o histórico e o saldo que sobrar continuam (dá para gastar o resto). Mudar o valor mensal (Editar) vale só para os próximos créditos. O app não conhece feriados: se o crédito real cair em outro dia, o saldo só difere por alguns dias.
- **Compra no cartão**: botão **+** → aba **Cartão** → valor total e número de parcelas (a prévia mostra as parcelas; o resto dos centavos vai na 1ª). A compra cai na fatura certa pela data (comprou no dia do fechamento ou depois → próxima fatura) e compromete o limite inteiro na hora.
- **Fatura**: no cartão, toque na fatura para ver os itens (separados por dia, com o total de cada dia), **Pagar fatura** (sugere o que falta; pode pagar só uma parte, e o resto fica na fatura) e desfazer um pagamento. Se o banco mudar o fechamento, edite as datas: as compras afetadas mudam de fatura sozinhas e o app avisa quais foram.
- **Antecipar parcelas** (na tela da compra): escolha as parcelas (padrão: a última), informe quanto o banco cobrou (o desconto aparece como economia) e se entrou **na fatura** ou foi **pago avulso** pela conta.
- **Estorno**: **crédito, parcelas continuam** (estorno parcial) ou **cancelar a compra toda** (as parcelas que ainda não vieram somem; o que já foi cobrado volta como um crédito). O Gasto Bruto abate o estorno no mês em que ele aconteceu.
- **Excluir compra**: só enquanto nada foi cobrado (nenhuma fatura fechou, sem antecipação nem estorno); depois disso, use o estorno.
- **Parcelamento em andamento** (na tela do cartão): para compras parceladas de antes de usar o Finah. Informe o total, a parcela atual (ex.: 9 de 10) e a fatura em que ela cai; só as restantes entram no limite.
- **Importar a fatura (OFX)** (no cartão → **Importar fatura (OFX)**): no app do Nubank, exporte a fatura em OFX e envie o arquivo. O Finah compara cada linha com o que já está lançado e abre a revisão: **É esse** para conciliar, **Criar lançamento** para o que é novo, **Ignorar** para o resto, ou os botões **Aceitar as sugestões** e **Criar as novas** de uma vez. Parcelas de compras antigas viram parcelamento em andamento; a "Parcela 1/N" pede o total da compra (confira no app do banco). Os pagamentos saem da conta principal. No alto, o app mostra "a pagar no app × no arquivo" para conferir centavo a centavo. Pode reimportar a fatura aberta durante o mês: só as linhas novas entram, e o mesmo arquivo não entra duas vezes.
- **Assinaturas no cartão**: em Fixos, escolha **Cartão de crédito** como meio. No dia da cobrança vira uma compra à vista na fatura certa.

- Destaques: **Atrasado**, **Vence hoje**, **Vence em até 3 dias**.

## Bot do Telegram

Pronto e testado, mas desligado por padrão (`BOT_MODE=off`). Para ligar:

1. No Telegram, crie o bot com o **@BotFather** e copie o token para `TELEGRAM_BOT_TOKEN`.
2. Descubra o **ID numérico** de cada um com o **@userinfobot** e coloque em `SEED_USER1_TELEGRAM_ID` e `SEED_USER2_TELEGRAM_ID`. Depois rode o seed de novo. O bot ignora qualquer outra pessoa.
3. Coloque sua chave da Anthropic em `ANTHROPIC_API_KEY`. `LLM_MODEL` é opcional: o padrão é `claude-haiku-5-5` (leve e barato, bastante para ler uma linha de gasto); só mude se quiser um modelo maior.
4. Escolha o modo:
   - **VPS (webhook)**: `BOT_MODE=webhook`, `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 32`) e `AUTH_URL=https://seu-dominio`. Suba a stack e rode `pnpm bot:webhook` uma vez.
   - **Local ou NAS (polling)**: `BOT_MODE=polling` e reinicie o `worker`. Não precisa de domínio nem de porta aberta.

Como usar: mande, por exemplo, `mercado 180 no pix`, `uber 23,50 débito`, `farmácia 42,90 dinheiro ontem` ou `tênis 600 no nubank em 3x`. Se o bot tiver certeza, ele lança na hora e mostra o saldo (ou, no cartão, a fatura e o limite disponível), com o botão **↩️ Desfazer**. Se não, mostra o que entendeu e pede **✅ Confirmar / ❌ Cancelar**. `/desfazer` desfaz o seu último lançamento (até 24h). Errou a categoria ou de quem é o gasto? Toque em **✏️ Corrigir** (antes de confirmar ou até 24h depois de lançar) e escolha a categoria ou "casal / pessoa". Para corrigir valor, data ou forma de pagamento, desfaça e mande de novo. **Receitas também**: "recebi 5000 de salário", "caiu 1200 de freela no pix", "salário da Viviane 3500". Sem a forma de recebimento, vira "Outro"; receita no cartão de crédito é recusada.

Consultas, com as suas palavras ou por comando (o bot só lê, nunca lança por uma pergunta): `/saldo` (saldo atual e previsto para o fim do mês), `/limite [cartão]` (limite disponível, em uso e fatura aberta), `/pendentes [mês]` (contas a pagar e a receber, inclusive o que falta das faturas que vencem no mês), `/fatura [cartão] [mês]` (total, datas, maiores compras e categorias da fatura; sem mês, a aberta), `/gastos [mês]` (compras do mês e o que sai da conta, por categoria), `/resumo [mês]` (entrou, saiu, falta e saldo do mês) e `/ultimos`. Exemplos: "quanto tenho de limite no nubank?", "o que falta pagar em novembro?", "como tá a fatura do nubank?", "quanto gastei com mercado esse mês?". **Sem mês dito, vale o mês atual**; aceita "novembro", "11/2026", "próximo" e "passado" (nome do mês sem ano = este ano) e a resposta sempre escreve o mês que entendeu. Todo dia às 9h, com o bot ligado, os dois recebem um lembrete das contas que vencem no dia e das faturas que vencem em 2 dias com valor a pagar. Sem nada a lembrar, não chega mensagem.

## Produção (VPS)

1. DNS do domínio apontando para a VPS; portas 80 e 443 liberadas.
2. `cp .env.example .env` e preencha **tudo**, incluindo `DOMAIN`, `AUTH_SECRET` (`openssl rand -base64 33`) e uma senha forte só com letras e números em `POSTGRES_PASSWORD`.
3. Suba a stack:
   ```bash
   docker compose --profile vps up -d --build
   docker compose run --rm app node dist/seed.mjs
   ```
4. Acesse `https://<DOMAIN>` e entre com cada um dos dois usuários.

O serviço `migrate` aplica as migrações a cada `up`, antes de `app` e `worker` subirem.
Para conferir tudo de uma vez numa máquina com Docker: `bash scripts/compose-smoke.sh` (sobe do zero, faz seed, testa os dois logins, o PWA, o worker e um backup/restore, e derruba tudo no final; **use um `.env` de teste**, porque o script apaga os volumes).

### Produção atual: finahapp.com (Ubuntu 24.04 + nginx)

Em produção usamos **nginx no host** com Let's Encrypt (Certbot), e não o Caddy do perfil `vps`:

- Código em `/opt/finah` (enviado por `tar` via SSH; não há git na VPS) e `.env` só da VPS (segredos próprios, `chmod 600`, `AUTH_URL=https://finahapp.com`, `BOT_MODE=off`).
- `docker compose up -d --build` (sem o perfil `vps`): o app fica só em `127.0.0.1:3000` e o Postgres só em `127.0.0.1:5432`.
- nginx: `/etc/nginx/sites-available/finah` faz proxy de `finahapp.com` e `www.finahapp.com` para `127.0.0.1:3000` (`client_max_body_size 2m`). O HTTPS e o redirecionamento 80→443 vêm do `certbot --nginx`, e a renovação é automática (`certbot.timer`).
- Firewall (ufw): só 22, 80 e 443.

### Ambiente de dev (dev.finahapp.com)

Na mesma VPS, isolado da produção: código em `/opt/finah-dev`, projeto Compose `finah-dev` (`docker compose -p finah-dev ...`), **Postgres e volume próprios** (banco `finah_dev`), app em `127.0.0.1:3001`, banco em `127.0.0.1:5433`, imagem `finah-dev:local` e `.env` próprio (segredos diferentes, `AUTH_URL=https://dev.finahapp.com`, `BOT_MODE=off`, sem chave da Anthropic e sem backup no Drive). O nginx usa `/etc/nginx/sites-available/finah-dev` e o HTTPS vem do `certbot --nginx -d dev.finahapp.com`.

- **Deploy**: todo push na `dev` roda o CI e publica aqui (`deploy-dev.yml`), com o mesmo desenho do deploy de produção (volta para a imagem anterior se falhar), só que sem o backup prévio: é um ambiente descartável.
- **Acesso**: o nginx pede um usuário e senha próprios (HTTP Basic, `/etc/nginx/finah-dev.htpasswd`) antes de chegar no app, e manda `noindex` para os buscadores. Só `/api/health` fica aberto (o deploy confere a saúde por ali). Para trocar a senha: `printf 'finah:%s\n' "$(openssl passwd -6)" > /etc/nginx/finah-dev.htpasswd && systemctl reload nginx`.
- **Dados**: só **dados fictícios** (seed com usuários e senhas de teste, diferentes da produção). Nunca copie o banco de produção para cá: o dev existe para testar, não para guardar dados reais. Para zerar: `docker compose -p finah-dev down -v`, `up -d` e rode o seed (`docker compose -p finah-dev run --rm app node dist/seed.mjs`). O login também pede 2FA: cada um cadastra um autenticador de dev no 1º login.
- **Bot**: desligado no dev. Um bot do Telegram só aponta para um webhook, e ele está na produção.

**Atualizar a produção** (na sua máquina, na raiz do projeto):

```bash
tar --exclude=./node_modules --exclude=./.next --exclude=./.next-e2e --exclude=./dist \
    --exclude=./test-results --exclude=./tmp --exclude=./backups --exclude=./.env \
    --exclude=./.env.bak --exclude=./docker/backup/rclone \
    -czf - . | ssh deploy@<ip-da-vps> 'tar -xzf - -C /opt/finah'
ssh deploy@<ip-da-vps> 'cd /opt/finah && docker compose up -d --build'
```

**Copiar os dados do banco local para a VPS** (uma vez, ou para refazer a produção a partir do local): `VPS=deploy@<ip-da-vps> bash scripts/sync-db-to-vps.sh`. Só funciona com o Docker local ligado. O script faz um backup de segurança da VPS, substitui o banco da VPS pelo local e confere as contagens. Ele recusa se a VPS já tiver lançamentos (use `--force` só se for isso mesmo que você quer). Depois que a produção passa a ser a fonte dos dados, **não rode mais**: ele apagaria o que foi lançado só na VPS.

### Instalar no celular

Abra o endereço no Chrome (Android) ou Safari (iOS) → menu → **Adicionar à tela inicial**. Precisa de HTTPS (Caddy ou nginx + Certbot, conforme acima).

### NAS (futuro)

Mesmo Compose, sem o perfil `vps`: `APP_BIND=0.0.0.0` no `.env` e acesso pela rede local ou Tailscale.
Para usar a imagem publicada pelo workflow `Imagem` (amd64 + arm64): `FINAH_IMAGE=ghcr.io/<dono>/<repo>:<tag>` e `docker compose up -d --no-build`.

## Segurança

- **Login**: senha + **código do app autenticador** (Google Authenticator, 1Password, Authy…). No 1º login o app mostra um QR code para cadastrar o autenticador e **10 códigos de recuperação**: guarde-os no gerenciador de senhas. Cada código de recuperação entra uma vez só, no lugar do código do app.
- **Ajustes → Segurança**: trocar a senha (pelo menos 12 caracteres; derruba todas as sessões), gerar novos códigos de recuperação, trocar de app autenticador (celular novo) e **sair de todos os aparelhos** (celular perdido).
- **Perdi o celular**: entre com um código de recuperação e use "Trocar de app autenticador" em Ajustes. **Perdi o celular e os códigos**: na VPS, zere o 2FA da pessoa e ela cadastra de novo no próximo login:
  `docker compose exec backup psql -c "update users set totp_secret = null, totp_pending_secret = null, totp_enabled_at = null, recovery_code_hashes = '{}', session_version = session_version + 1 where email = 'email@da.pessoa'"`
- **AUTH_SECRET**: assina as sessões e cifra os segredos do 2FA. Trocar o AUTH_SECRET derruba todas as sessões **e** invalida os autenticadores (rode o comando acima para os dois e cadastrem de novo).
- **O que protege o app**: CSP com nonce (nenhum script de fora roda), cabeçalhos de segurança, HSTS, limite de tentativas de login (no nginx e no app, por email e por IP), sessões que caem quando a senha muda, nada de dado sensível em log.
- **VPS**: SSH só com chave (login por senha desligado; root só com a chave), fail2ban (bane IP que erra o SSH; reincidente fica 1 semana), atualizações de segurança automáticas (`unattended-upgrades`; reinicie quando `/var/run/reboot-required` existir), ufw só com 22/80/443, banco e app só em `127.0.0.1`, nginx sem versão no cabeçalho e quem acessa pelo IP é recusado. Ver banidos: `fail2ban-client status sshd`.
- **Chaves que só você tem**: a chave SSH do seu PC (`~/.ssh/id_ed25519`), a **chave privada dos backups** (age) e os códigos de recuperação. Guarde as três no gerenciador de senhas e numa cópia offline.

## Backup

O serviço `backup` roda `pg_dump` todo dia às 03:00 (America/Sao_Paulo) em `./backups/daily`, copia o de domingo para `./backups/weekly` e mantém 14 diários + 8 semanais (ajustável no `.env`).
Cópia off-site opcional: coloque um `rclone.conf` em `docker/backup/rclone/` e defina `RCLONE_REMOTE` (ex.: `b2:finah-backups`). A cópia é um `rclone copy`: um disco local vazio nunca apaga o que já está na nuvem.

**A cópia off-site sai cifrada** (age) para a chave pública `BACKUP_AGE_RECIPIENT` do `.env`: o Drive só guarda arquivos `.dump.age`, ilegíveis sem a chave privada (`AGE-SECRET-KEY-...`), que fica **só com você** (gerenciador de senhas + cópia offline), nunca na VPS. Com `RCLONE_REMOTE` e sem a chave pública, o backup não envia nada (falha avisando). Os dumps locais da VPS (`./backups/daily`) ficam sem cifra, para restaurar rápido.

**Restaurar um backup do Drive**: baixe o `.dump.age`, copie-o e a chave privada para `/opt/finah/backups/` na VPS e rode `docker compose exec -e AGE_IDENTITY=/backups/chave.txt backup restore.sh /backups/<arquivo>.dump.age` (restaura num banco novo e compara as contagens). **Apague a chave da VPS em seguida** (`rm /opt/finah/backups/chave.txt`). Para só decifrar na sua máquina: `age -d -i chave.txt -o backup.dump arquivo.dump.age`.

**Produção (Google Drive):** `RCLONE_REMOTE=gdrive:finah-backups`, com escopo `drive.file` (o backup só enxerga os arquivos que ele mesmo criou, nunca o resto do Drive). Para refazer a autorização (token revogado ou conta trocada), na sua máquina com o rclone, rode `rclone authorize drive --drive-scope drive.file` e cole o JSON do token em `/opt/finah/docker/backup/rclone/rclone.conf` na VPS, na seção `[gdrive]` (`type = drive`, `scope = drive.file`, `token = {...}`). O Drive **não apaga** backups antigos sozinho: de vez em quando, limpe a pasta `finah-backups`.

```bash
docker compose exec backup backup.sh                 # backup agora
docker compose exec backup restore.sh latest         # restaura o último num banco NOVO (finah_restore) e compara as contagens
docker compose exec backup restore.sh /backups/daily/finah-AAAAMMDD-HHMMSS.dump outro_nome
```

O `restore.sh` nunca toca no banco em uso. **Restaurar de verdade** (desastre):

```bash
docker compose stop app worker
docker compose exec backup psql -d postgres -c 'drop database finah' -c 'create database finah'
docker compose exec backup pg_restore --no-owner --no-privileges --exit-on-error -d finah /backups/daily/<arquivo>.dump
docker compose up -d
```

## Estrutura

Veja a seção "Estrutura" do [CLAUDE.md](../CLAUDE.md). Pontos de entrada fora do Next (`src/worker`, `src/db/migrate.ts`, `src/db/seed.ts`) são empacotados com esbuild em `dist/*.mjs` e rodam na mesma imagem do app.
