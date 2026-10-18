#!/bin/sh
# Restaura um dump num banco NOVO e compara a contagem de linhas com o banco atual.
# Nunca sobrescreve o banco em uso.
#
#   docker compose exec backup restore.sh latest                  # último diário → finah_restore
#   docker compose exec backup restore.sh /backups/daily/X.dump meu_teste
#
# Para promover o restore a banco principal, veja "Restaurar de verdade" no README.
set -eu

src="${1:?uso: restore.sh <arquivo.dump|latest> [banco_destino]}"
target="${2:-finah_restore}"

if [ "$src" = "latest" ]; then
  src="$(ls -1t /backups/daily/finah-*.dump 2>/dev/null | head -n 1)"
  [ -n "$src" ] || { echo "[restore] nenhum backup em /backups/daily"; exit 1; }
fi
[ -f "$src" ] || { echo "[restore] arquivo não encontrado: $src"; exit 1; }
[ "$target" != "$PGDATABASE" ] || { echo "[restore] o destino não pode ser o banco em uso ($PGDATABASE)"; exit 1; }

echo "[restore] $src → banco limpo \"$target\""
psql -v ON_ERROR_STOP=1 -d postgres -qc "drop database if exists \"$target\""
psql -v ON_ERROR_STOP=1 -d postgres -qc "create database \"$target\""
pg_restore --no-owner --no-privileges --exit-on-error -d "$target" "$src"

TABLES="users bank_accounts categories credit_cards invoices transactions installment_plans invoice_items anticipation_records refund_records recurring_templates balance_checkpoints audit_log"
status=0
printf '%-22s %10s %10s\n' tabela atual restaurado
for t in $TABLES; do
  a="$(psql -tAc "select count(*) from $t")"
  b="$(psql -d "$target" -tAc "select count(*) from $t")"
  mark=""; [ "$a" = "$b" ] || { mark="  ← difere (normal se houve lançamentos depois do backup)"; status=2; }
  printf '%-22s %10s %10s%s\n' "$t" "$a" "$b" "$mark"
done

echo "[restore] ok: banco \"$target\" criado a partir de $(basename "$src")"
exit $status
