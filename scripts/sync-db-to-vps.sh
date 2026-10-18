#!/usr/bin/env bash
# Copia o banco LOCAL (Docker Compose da sua máquina) para o banco da VPS.
# Uso, na raiz do projeto, num Git Bash:
#   VPS=deploy@<ip-da-vps> bash scripts/sync-db-to-vps.sh [--force]
#
# O que faz:
#   1. pg_dump do banco local (schemas public e drizzle; o pg-boss é recriado pelo worker);
#   2. envia o dump para a VPS;
#   3. na VPS: backup de segurança do que estiver lá, para app e worker, SUBSTITUI o conteúdo
#      do banco pelo dump, sobe tudo de novo (o migrate aplica o que faltar);
#   4. confere as contagens de linhas das tabelas principais, local × VPS.
#
# Proteção: se o banco da VPS já tiver lançamentos, recusa sem --force (evita apagar dados
# de produção por engano). Esta é uma cópia de UM sentido: local → VPS.
set -euo pipefail

VPS="${VPS:?defina VPS=usuario@host (ex.: deploy@<ip-da-vps>)}"
REMOTE_DIR="${REMOTE_DIR:-/opt/finah}"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

export MSYS_NO_PATHCONV=1 # Git Bash não pode reescrever caminhos do container

envval() { grep -E "^$1=" .env | cut -d= -f2- | tr -d "'\""; }
PGUSER_LOCAL="$(envval POSTGRES_USER)"; PGUSER_LOCAL="${PGUSER_LOCAL:-finah}"
PGDB_LOCAL="$(envval POSTGRES_DB)"; PGDB_LOCAL="${PGDB_LOCAL:-finah}"

COUNT_SQL="select 'users', count(*) from users
 union all select 'bank_accounts', count(*) from bank_accounts
 union all select 'transactions', count(*) from transactions
 union all select 'credit_cards', count(*) from credit_cards
 union all select 'invoices', count(*) from invoices
 union all select 'invoice_items', count(*) from invoice_items
 union all select 'installment_plans', count(*) from installment_plans
 union all select 'import_lines', count(*) from import_lines
 union all select 'audit_log', count(*) from audit_log
 union all select 'saldo_inicial_centavos', coalesce(sum(opening_balance_cents), 0) from bank_accounts
 order by 1"

dump="$(mktemp -t finah-sync-XXXXXX.dump)"
trap 'rm -f "$dump"' EXIT

echo "→ 1/5 dump do banco local ($PGDB_LOCAL)"
docker compose exec -T db pg_dump -U "$PGUSER_LOCAL" -d "$PGDB_LOCAL" \
  --format=custom --no-owner --no-privileges --exclude-schema=pgboss >"$dump"
items="$(docker compose exec -T db pg_restore --list <"$dump" | wc -l)"
[ "$items" -gt 20 ] || { echo "dump parece vazio/inválido"; exit 1; }
echo "   $(du -h "$dump" | cut -f1), $items itens"

local_counts="$(docker compose exec -T db psql -U "$PGUSER_LOCAL" -d "$PGDB_LOCAL" -tA -F' ' -c "$COUNT_SQL" </dev/null)"

echo "→ 2/5 enviando para a VPS"
scp -q "$dump" "$VPS:$REMOTE_DIR/backups/sync-incoming.dump"

COUNT_B64="$(printf '%s' "$COUNT_SQL" | base64 | tr -d '\n')"

echo "→ 3/5 restaurando na VPS"
# O script segue por stdin: todo `docker compose exec` precisa de </dev/null (ou de um
# redirecionamento próprio), senão ele consome o resto do script.
ssh "$VPS" FORCE="$FORCE" REMOTE_DIR="$REMOTE_DIR" bash -s <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"
envval() { grep -E "^$1=" .env | cut -d= -f2- | tr -d "'\""; }
PGU="$(envval POSTGRES_USER)"; PGU="${PGU:-finah}"
PGD="$(envval POSTGRES_DB)"; PGD="${PGD:-finah}"
psql_() { docker compose exec -T db psql -U "$PGU" -d "$PGD" -v ON_ERROR_STOP=1 "$@" </dev/null; }

existing="$(psql_ -tA -c 'select count(*) from transactions' 2>/dev/null || echo 0)"
if [ "$existing" != "0" ] && [ "$FORCE" != "1" ]; then
  echo "A VPS já tem $existing lançamentos. Nada foi alterado. Use --force se quiser SUBSTITUIR."
  rm -f backups/sync-incoming.dump
  exit 3
fi

echo "   backup de segurança do estado atual da VPS"
docker compose exec -T backup backup.sh </dev/null | tail -1

echo "   parando app, worker e backup"
docker compose stop app worker backup </dev/null >/dev/null 2>&1

psql_ -q -c 'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;'
docker compose exec -T db pg_restore -U "$PGU" -d "$PGD" --no-owner --no-privileges --exit-on-error \
  <backups/sync-incoming.dump
rm -f backups/sync-incoming.dump

echo "   subindo de novo (o migrate aplica o que faltar)"
docker compose up -d </dev/null >/dev/null 2>&1
for _ in $(seq 1 40); do
  docker compose ps app --format '{{.Status}}' </dev/null | grep -q healthy && break
  sleep 3
done
docker compose ps --format '   {{.Name}} {{.Status}}' </dev/null
REMOTE

echo "→ 4/5 contagens na VPS"
remote_counts="$(ssh "$VPS" COUNT_B64="$COUNT_B64" REMOTE_DIR="$REMOTE_DIR" bash -s <<'REMOTE2'
cd "$REMOTE_DIR"
envval() { grep -E "^$1=" .env | cut -d= -f2- | tr -d "'\""; }
PGU="$(envval POSTGRES_USER)"; PGD="$(envval POSTGRES_DB)"
echo "$COUNT_B64" | base64 -d | docker compose exec -T db psql -U "${PGU:-finah}" -d "${PGD:-finah}" -tA -F' ' -f -
REMOTE2
)"

echo "→ 5/5 conferência local × VPS"
if [ "$local_counts" = "$remote_counts" ]; then
  echo "$remote_counts" | sed 's/^/   /'
  echo "OK: todas as contagens (e o saldo inicial) são idênticas."
else
  echo "DIFERENTE!"
  diff <(echo "$local_counts") <(echo "$remote_counts") || true
  exit 2
fi
