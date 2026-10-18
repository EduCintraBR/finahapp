#!/bin/sh
# Agenda o backup.sh no cron do busybox com o horário de BACKUP_CRON (padrão: 03:00 todo dia).
set -eu

# O cron não herda o ambiente do container: salva as variáveis que o backup usa.
env | grep -E '^(PG|BACKUP_|RCLONE_|TZ=)' | sed "s/'/'\\\\''/g; s/=\(.*\)/='\1'/; s/^/export /" > /etc/backup.env

echo "${BACKUP_CRON:-0 3 * * *} . /etc/backup.env && /usr/local/bin/backup.sh > /proc/1/fd/1 2>&1" > /etc/crontabs/root

echo "[backup] agendado: ${BACKUP_CRON:-0 3 * * *} (TZ=${TZ:-UTC}); destino /backups"
exec crond -f -l 8
