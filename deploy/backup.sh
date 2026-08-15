#!/bin/sh
# Daily pg_dump into the `backups` volume, keeping RETENTION_DAYS of history.
#
# A full logical dump of the database: schema and data, `public` and `auth` together. That
# is what makes the restore in README.md work against an empty stack — the dump carries the
# users, so nothing has to be provisioned again.
#
# Deliberately dumb: a sleep loop, no cron, no lock file. One process, one job.
set -eu

RETENTION_DAYS="${RETENTION_DAYS:-14}"
DEST=/backups

while true; do
	stamp=$(date -u +%Y-%m-%d)
	file="$DEST/financas-$stamp.sql.gz"

	# Written to .part first: a dump interrupted halfway must never be mistaken for a
	# backup, which is exactly the file you would reach for on the worst day.
	if pg_dump -h db -U postgres -d postgres --clean --if-exists | gzip -9 >"$file.part"; then
		mv "$file.part" "$file"
		echo "$(date -u +%FT%TZ) backup ok: $file ($(du -h "$file" | cut -f1))"
	else
		rm -f "$file.part"
		echo "$(date -u +%FT%TZ) backup FAILED" >&2
	fi

	find "$DEST" -name 'financas-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete
	sleep 86400
done
