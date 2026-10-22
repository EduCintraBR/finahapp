#!/bin/sh
# Backup do Postgres: dump diário (formato custom), cópia semanal aos domingos,
# retenção de BACKUP_KEEP_DAILY diários e BACKUP_KEEP_WEEKLY semanais,
# e cópia off-site opcional via rclone (RCLONE_REMOTE, ex.: "b2:finah-backups").
# A cópia off-site é SEMPRE cifrada com age para a chave pública BACKUP_AGE_RECIPIENT: o Drive/B2 só vê
# arquivos .dump.age. A chave privada fica com o dono (fora da VPS). Sem a chave pública, nada é enviado.
# Rodar na mão: docker compose exec backup backup.sh
set -eu

KEEP_DAILY="${BACKUP_KEEP_DAILY:-14}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-8}"
DIR=/backups
mkdir -p "$DIR/daily" "$DIR/weekly" "$DIR/offsite/daily" "$DIR/offsite/weekly"

stamp="$(date +%Y%m%d-%H%M%S)"
file="$DIR/daily/finah-$stamp.dump"

echo "[backup] $(date -Iseconds) gerando $file"
pg_dump --format=custom --no-owner --no-privileges --file="$file.partial"
# Garante que o arquivo é legível pelo pg_restore antes de considerá-lo válido.
pg_restore --list "$file.partial" > /dev/null
mv "$file.partial" "$file"

if [ "$(date +%u)" = "7" ]; then
  cp "$file" "$DIR/weekly/"
  echo "[backup] cópia semanal criada"
fi

prune() { # prune <dir> <quantos manter>
  ls -1t "$1"/finah-*.dump 2>/dev/null | tail -n "+$(($2 + 1))" | while read -r old; do
    rm -f "$old"
    echo "[backup] removido $old"
  done
}
prune "$DIR/daily" "$KEEP_DAILY"
prune "$DIR/weekly" "$KEEP_WEEKLY"

if [ -n "${RCLONE_REMOTE:-}" ]; then
  if [ -z "${BACKUP_AGE_RECIPIENT:-}" ]; then
    echo "[backup] ERRO: RCLONE_REMOTE definido sem BACKUP_AGE_RECIPIENT; nada foi enviado (backup sem cifra não sai da VPS)"
    exit 1
  fi
  enc="$DIR/offsite/daily/$(basename "$file").age"
  age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$enc.partial" "$file"
  mv "$enc.partial" "$enc"
  if [ "$(date +%u)" = "7" ]; then cp "$enc" "$DIR/offsite/weekly/"; fi
  pruneage() { ls -1t "$1"/finah-*.dump.age 2>/dev/null | tail -n "+$(($2 + 1))" | while read -r old; do rm -f "$old"; done; }
  pruneage "$DIR/offsite/daily" "$KEEP_DAILY"
  pruneage "$DIR/offsite/weekly" "$KEEP_WEEKLY"
  # copy (não sync): um disco local vazio nunca apaga os backups remotos. Só a pasta cifrada sai.
  rclone copy "$DIR/offsite" "$RCLONE_REMOTE" --config /config/rclone/rclone.conf
  echo "[backup] cópia cifrada enviada para $RCLONE_REMOTE ($(basename "$enc"))"
fi

echo "[backup] ok ($(du -h "$file" | cut -f1))"
