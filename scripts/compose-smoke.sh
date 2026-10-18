#!/usr/bin/env bash
# Smoke test da stack Docker do zero, cobrindo os critérios de pronto da Fase 1:
#   sobe tudo → seed → os dois logins funcionam → manifest/ícones do PWA → worker no ar
#   → backup → restore num banco limpo com as mesmas contagens.
#
# Uso: scripts/compose-smoke.sh            (precisa de um .env; o CI gera um de teste)
#      KEEP=1 scripts/compose-smoke.sh     (não derruba a stack no final)
set -euo pipefail

# Lê uma variável do .env sem executá-lo (valores podem ter espaços, ex.: BACKUP_CRON).
envget() { { grep -E "^$1=" .env || true; } | tail -n 1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/'; }
SEED_USER1_NAME="$(envget SEED_USER1_NAME)"; SEED_USER1_EMAIL="$(envget SEED_USER1_EMAIL)"
SEED_USER1_PASSWORD="$(envget SEED_USER1_PASSWORD)"; SEED_USER2_NAME="$(envget SEED_USER2_NAME)"
SEED_USER2_EMAIL="$(envget SEED_USER2_EMAIL)"; SEED_USER2_PASSWORD="$(envget SEED_USER2_PASSWORD)"

APP_PORT="$(envget APP_PORT)"
BASE="${BASE_URL:-http://127.0.0.1:${APP_PORT:-3000}}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"; [ "${KEEP:-0}" = 1 ] || docker compose down -v --remove-orphans >/dev/null 2>&1 || true' EXIT

step() { printf '\n▶ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; docker compose logs --tail=80 >&2 || true; exit 1; }

step "Subindo a stack (build + migrate)"
docker compose up -d --build
for i in $(seq 1 60); do
  curl -fsS "$BASE/api/health" >/dev/null 2>&1 && break
  [ "$i" = 60 ] && fail "app não respondeu em /api/health"
  sleep 2
done
echo "✓ app saudável"

step "Seed"
docker compose run --rm app node dist/seed.mjs

login() { # login <email> <senha> <nome esperado>
  rm -f "$JAR"
  local csrf
  csrf="$(curl -fsS -c "$JAR" -b "$JAR" "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')"
  curl -fsS -o /dev/null -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/callback/credentials" \
    --data-urlencode "csrfToken=$csrf" --data-urlencode "email=$1" --data-urlencode "password=$2" \
    --data-urlencode "callbackUrl=$BASE/"
  curl -fsS -b "$JAR" "$BASE/api/auth/session" | grep -q "\"name\":\"$3\"" || fail "login de $1 falhou"
  [ "$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" "$BASE/")" = 200 ] || fail "home não abriu para $1"
  echo "✓ login de $3"
}

step "Logins"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")" = 307 ] || fail "home sem sessão deveria redirecionar para /login"
login "$SEED_USER1_EMAIL" "$SEED_USER1_PASSWORD" "$SEED_USER1_NAME"
login "$SEED_USER2_EMAIL" "$SEED_USER2_PASSWORD" "$SEED_USER2_NAME"

step "PWA"
curl -fsS "$BASE/manifest.webmanifest" | grep -q '"display":"standalone"' || fail "manifest inválido"
for f in icon-192.png icon-512.png maskable-512.png; do
  curl -fsS -o /dev/null "$BASE/icons/$f" || fail "ícone $f ausente"
done
curl -fsS -o /dev/null "$BASE/sw.js" || fail "service worker ausente"
echo "✓ manifest, ícones e service worker"

step "Worker"
for i in $(seq 1 15); do
  docker compose logs worker 2>/dev/null | grep -q 'pg-boss iniciado' && break
  [ "$i" = 15 ] && fail "worker não iniciou"
  sleep 2
done
echo "✓ worker no ar"

step "Backup e restore num banco limpo"
docker compose exec -T backup backup.sh
docker compose exec -T backup restore.sh latest finah_restore_check
docker compose exec -T backup psql -d postgres -qc 'drop database finah_restore_check'
echo "✓ backup restaurado com as mesmas contagens"

printf '\n✓ Smoke test completo\n'
