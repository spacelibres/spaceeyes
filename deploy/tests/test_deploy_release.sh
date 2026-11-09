#!/usr/bin/env bash
set -Eeuo pipefail
repo="$(cd -- "$(dirname -- "$0")/../.." && pwd)"
temp="$(mktemp -d)"
trap 'rm -rf -- "$temp"' EXIT
root="$temp/app"
mkdir -p "$root/bin" "$root/releases" "$root/shared/cache" "$root/incoming" "$root/node/bin" "$temp/fake" "$temp/package/web/.next" "$temp/package/web/public/wasm"
cp "$repo/deploy/validate_archive.py" "$root/bin/validate_archive.py"
printf x > "$temp/package/web/server.js"
printf x > "$temp/package/web/.next/BUILD_ID"
printf x > "$temp/package/web/public/wasm/spaceeyes_core_bg.wasm"
tar -czf "$temp/package.tar.gz" -C "$temp/package" .
cat > "$temp/fake/curl" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *api.github.com*) printf '{"sha":"%s"}' "$EXPECTED_SHA" ;;
  *127.0.0.1:3100*) [[ "${FAIL_LIVE:-0}" != 1 ]] ;;
  *) exit 0 ;;
esac
SH
cat > "$temp/fake/runuser" <<'SH'
#!/usr/bin/env bash
exec /bin/sleep 300
SH
cat > "$temp/fake/systemctl" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$SYSTEMCTL_LOG"
SH
printf '#!/usr/bin/env bash\nexit 0\n' > "$temp/fake/chown"
printf '#!/usr/bin/env bash\nexit 0\n' > "$temp/fake/sleep"
chmod +x "$temp/fake/"*
export PATH="$temp/fake:$PATH" SPACEEYES_DEPLOY_ROOT="$root" SPACEEYES_DISK_LIMIT_KIB=999999999 SYSTEMCTL_LOG="$temp/systemctl.log"
old="$(printf 'c%.0s' {1..40})"
mkdir "$root/releases/$old"
ln -s "$root/releases/$old" "$root/current"
export EXPECTED_SHA="$(printf 'a%.0s' {1..40})"
bash "$repo/deploy/deploy-release.sh" "$EXPECTED_SHA" "$temp/package.tar.gz"
[[ "$(readlink "$root/current")" = "$root/releases/$EXPECTED_SHA" ]]
successful="$EXPECTED_SHA"
export EXPECTED_SHA="$(printf 'b%.0s' {1..40})" FAIL_LIVE=1
if bash "$repo/deploy/deploy-release.sh" "$EXPECTED_SHA" "$temp/package.tar.gz"; then
  echo 'expected live health failure' >&2; exit 1
fi
[[ "$(readlink "$root/current")" = "$root/releases/$successful" ]]
[[ ! -e "$root/releases/$EXPECTED_SHA" ]]
echo 'release switch and rollback verified'
