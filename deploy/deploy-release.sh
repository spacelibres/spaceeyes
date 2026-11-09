#!/usr/bin/env bash
set -Eeuo pipefail

root="${SPACEEYES_DEPLOY_ROOT:-/opt/spaceeyes}"
sha="${1:-}"
archive="${2:-}"
[[ "$root" = /* && "$sha" =~ ^[a-f0-9]{40}$ && -f "$archive" ]] || { echo 'invalid deployment input' >&2; exit 1; }
disk_limit="${SPACEEYES_DISK_LIMIT_KIB:-18874368}"
[[ "$disk_limit" =~ ^[0-9]+$ ]] || { echo 'invalid disk limit' >&2; exit 1; }
[[ $(df -Pk "$root" | awk 'NR==2 {print $3}') -lt "$disk_limit" ]] || { echo '20 GiB disk reserve reached' >&2; exit 1; }
python3 "$root/bin/validate_archive.py" "$archive"

release="$root/releases/$sha"
staging="$root/releases/$sha.staging"
previous="$(readlink "$root/current" 2>/dev/null || true)"
candidate_pid=''
switched=0
created=0
completed=0
cleanup() {
  if [[ -n "$candidate_pid" ]]; then kill "$candidate_pid" 2>/dev/null || true; wait "$candidate_pid" 2>/dev/null || true; fi
  if [[ -d "$staging" ]]; then rm -rf -- "$staging"; fi
  if [[ "$created" = 1 && "$completed" = 0 && -d "$release" && "$(readlink "$root/current" 2>/dev/null || true)" != "$release" ]]; then rm -rf -- "$release"; fi
}
rollback() {
  if [[ "$switched" = 1 ]]; then
    if [[ -n "$previous" && -d "$previous" ]]; then
      ln -sfn -- "$previous" "$root/current.rollback"
      mv -Tf -- "$root/current.rollback" "$root/current"
      systemctl restart spaceeyes-web.service || true
    else
      systemctl stop spaceeyes-web.service || true
      rm -f -- "$root/current"
    fi
  fi
}
trap cleanup EXIT
trap rollback ERR
mkdir -p -- "$root/releases" "$root/shared/cache/next"
chown spaceeyes:spaceeyes "$root/shared/cache/next"
[[ ! -e "$staging" && ! -e "$release" ]] || { echo 'release already exists' >&2; exit 1; }
mkdir -- "$staging"
tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$staging"
[[ -f "$staging/web/server.js" && -f "$staging/web/public/wasm/spaceeyes_core_bg.wasm" ]] || exit 1
[[ ! -e "$staging/web/.cache" ]] || { echo 'unexpected packaged cache' >&2; exit 1; }
ln -s -- "$root/shared/cache" "$staging/web/.cache"
[[ ! -e "$staging/web/.next/cache" ]] || { echo 'unexpected packaged next cache' >&2; exit 1; }
ln -s -- "$root/shared/cache/next" "$staging/web/.next/cache"
chown -R root:root "$staging"
chmod -R a+rX "$staging"
mv -- "$staging" "$release"
created=1

# Probe the candidate without disturbing the live service.
(
  cd "$release/web"
  exec runuser -u spaceeyes -- env HOSTNAME=127.0.0.1 PORT=3101 NODE_ENV=production NODE_OPTIONS=--max-old-space-size=512 "$root/node/bin/node" server.js
) >"$root/incoming/candidate.log" 2>&1 &
candidate_pid=$!
ready=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:3101/ >/dev/null; then ready=1; break; fi
  kill -0 "$candidate_pid" 2>/dev/null || break
  sleep 1
done
[[ "$ready" = 1 ]] || { echo 'candidate health check failed' >&2; exit 1; }
kill "$candidate_pid" 2>/dev/null || true
wait "$candidate_pid" 2>/dev/null || true
candidate_pid=''

# A newer main commit must never be replaced by a slower old deployment.
latest="$(curl -fsS --max-time 10 -H 'User-Agent: spaceeyes-vps-deployment' https://api.github.com/repos/spacelibres/spaceeyes/commits/main | python3 -c 'import json,sys; print(json.load(sys.stdin)["sha"])')"
[[ "$latest" = "$sha" ]] || { echo 'main advanced during deployment' >&2; exit 1; }
ln -s -- "$release" "$root/current.next"
mv -Tf -- "$root/current.next" "$root/current"
switched=1
systemctl restart spaceeyes-web.service
ready=0
for _ in $(seq 1 45); do
  if curl -fsS --max-time 2 http://127.0.0.1:3100/ >/dev/null; then ready=1; break; fi
  sleep 1
done
[[ "$ready" = 1 ]] || { echo 'live health check failed' >&2; false; }
switched=0
completed=1

# Only release directories created by this service are eligible for cleanup.
python3 - "$root/releases" "$sha" <<'PY'
import pathlib, re, shutil, sys
root, current = pathlib.Path(sys.argv[1]), sys.argv[2]
releases = sorted((p for p in root.iterdir() if p.is_dir() and not p.is_symlink() and re.fullmatch(r'[0-9a-f]{40}', p.name)), key=lambda p: p.stat().st_mtime, reverse=True)
keep = {current}
keep.update(p.name for p in releases if p.name != current and len(keep) < 2)
for p in releases:
    if p.name not in keep:
        shutil.rmtree(p)
PY
echo "deployed $sha"
