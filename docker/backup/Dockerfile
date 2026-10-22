# pg_dump agendado (cron do busybox) + rclone opcional para cópia off-site.
FROM postgres:16-alpine
# age: o que vai para fora da VPS sai cifrado (BACKUP_AGE_RECIPIENT)
RUN apk add --no-cache rclone tzdata age
COPY --chmod=755 backup.sh restore.sh entrypoint.sh /usr/local/bin/
VOLUME ["/backups"]
ENTRYPOINT ["entrypoint.sh"]
