#!/bin/sh
# Backup do Postgres: dump diário (formato custom), cópia semanal aos domingos,
# retenção de BACKUP_KEEP_DAILY diários e BACKUP_KEEP_WEEKLY semanais,
# e cópia off-site opcional via rclone (RCLONE_REMOTE, ex.: "b2:finah-backups").
# Rodar na mão: docker compose exec backup backup.sh
set -eu

KEEP_DAILY="${BACKUP_KEEP_DAILY:-14}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-8}"
DIR=/backups
mkdir -p "$DIR/daily" "$DIR/weekly"

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
  # copy (não sync): um disco local vazio nunca apaga os backups remotos.
  rclone copy "$DIR" "$RCLONE_REMOTE" --config /config/rclone/rclone.conf
  echo "[backup] copiado para $RCLONE_REMOTE"
fi

echo "[backup] ok ($(du -h "$file" | cut -f1))"
