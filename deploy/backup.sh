#!/usr/bin/env bash
#
# The dump, on the VM, in shell.
#
# It exists in this language for one reason: since Fase 13 the VM is a container host and
# has no Node on it, so `scripts/db-backup.mjs` — which is what runs this same dump from
# your machine — cannot. Two callers up here:
#
#   * the systemd timer, every night at 03:20  (--label daily --keep 7)
#   * `pnpm server` and `pnpm db:restore --remote`, before they destroy anything
#     (--label pre-deploy --keep 7, --label pre-restore --keep 3)
#
# **The pg_dump flags below must stay identical to `dumpCommand` in scripts/lib/db.mjs.**
# A dump only one of the two produces is a backup you find out about during the restore, and
# `pnpm db:restore` is the same command for all of them.
#
#   ./backup.sh [--label <nome>] [--keep <n>]

set -euo pipefail

label=daily
keep=7

while [ $# -gt 0 ]; do
	case "$1" in
	--label)
		label="$2"
		shift 2
		;;
	--keep)
		keep="$2"
		shift 2
		;;
	*)
		echo "opção desconhecida: $1" >&2
		exit 1
		;;
	esac
done

case "$label" in
*[!a-z0-9-]*)
	echo "--label aceita apenas letras minúsculas, números e hífen." >&2
	exit 1
	;;
esac

cd "$(dirname "$0")"
mkdir -p backups

compose() {
	docker compose -f docker-compose.yml -f docker-compose.server.yml "$@"
}

target="backups/${label}-$(date +%Y-%m-%d_%H%M%S).dump"

# Written under a partial name and renamed at the end: a dump interrupted halfway never gets
# a name that a restore would pick up.
compose exec -T db pg_dump -U supabase_admin -d postgres \
	--format=custom \
	--schema=public --schema=auth --schema=supabase_migrations >"${target}.partial"
mv "${target}.partial" "$target"

# Cheap, and the difference between a backup and a file: a dump truncated by a full disk
# still looks fine in `ls`.
if ! compose exec -T db pg_restore --list <"$target" >/dev/null; then
	rm -f "$target"
	echo "o dump saiu ilegível e foi descartado" >&2
	exit 1
fi

echo "wrote $(pwd)/$target ($(du -h "$target" | cut -f1))"

# Pruning is per label, not per directory: the nightly dumps and the ones taken before a
# migration share this folder, and a single global count would let a busy afternoon of
# deploys evict every night of history.
existing=$(ls -1 "backups/${label}-"*.dump 2>/dev/null || true)
if [ -n "$existing" ]; then
	count=$(printf '%s\n' "$existing" | wc -l)
	if [ "$count" -gt "$keep" ]; then
		printf '%s\n' "$existing" | sort | head -n "$((count - keep))" | while read -r old; do
			rm -f "$old"
			echo "removido $old"
		done
	fi
fi
