#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 1; }
source_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
root=/opt/spaceeyes
install -d -m 755 "$root" "$root/bin" "$root/releases" "$root/shared"
install -d -m 700 "$root/incoming" /etc/spaceeyes
if ! id spaceeyes >/dev/null 2>&1; then useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin spaceeyes; fi
install -d -o spaceeyes -g spaceeyes -m 750 "$root/shared/cache" "$root/shared/cache/next"
if [[ ! -x "$root/node/bin/node" ]]; then
  node_tar="$root/incoming/node-v24.15.0-linux-x64.tar.gz"
  curl -fsSL --max-time 180 https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.gz -o "$node_tar"
  printf '%s  %s\n' '44836872d9aec49f1e6b52a9a922872db9a2b02d235a616a5681b6a85fec8d89' "$node_tar" | sha256sum -c -
  node_stage="$(mktemp -d "$root/incoming/node-install.XXXXXX")"
  tar -xzf "$node_tar" -C "$node_stage"
  mv "$node_stage/node-v24.15.0-linux-x64" "$root/node"
  rmdir "$node_stage"
  rm -f -- "$node_tar"
fi
[[ "$("$root/node/bin/node" --version)" = v24.15.0 ]] || { echo 'unexpected Node version' >&2; exit 1; }
[[ -f /etc/spaceeyes/webhook.secret ]] || { echo 'missing webhook secret' >&2; exit 1; }
chmod 600 /etc/spaceeyes/webhook.secret
install -m 755 "$source_dir/deploy-release.sh" "$root/bin/deploy-release.sh"
for file in receiver.mjs protocol.mjs cache-budget.mjs cache-maintain.mjs validate_archive.py; do install -m 644 "$source_dir/$file" "$root/bin/$file"; done
for file in spaceeyes-web.service spaceeyes-webhook.service spaceeyes-cache.service spaceeyes-cache.timer; do install -m 644 "$source_dir/$file" "/etc/systemd/system/$file"; done

if ! grep -q '^# BEGIN SPACEEYES MANAGED SITE$' /etc/caddy/Caddyfile; then
  if grep -q 'www\.spaceeyes\.cn' /etc/caddy/Caddyfile; then echo 'domain already configured; refusing to overwrite' >&2; exit 1; fi
  candidate="$(mktemp /etc/caddy/Caddyfile.spaceeyes.XXXXXX)"
  cp -a /etc/caddy/Caddyfile "$candidate"
  cat >> "$candidate" <<'CADDY'

# BEGIN SPACEEYES MANAGED SITE
www.spaceeyes.cn {
    handle_path /_spaceeyes/* {
        reverse_proxy 127.0.0.1:9876
    }
    handle {
        reverse_proxy 127.0.0.1:3100
    }
}
# END SPACEEYES MANAGED SITE
CADDY
  caddy validate --config "$candidate" --adapter caddyfile
  cp -a /etc/caddy/Caddyfile "$root/Caddyfile.before-spaceeyes"
  mv -f -- "$candidate" /etc/caddy/Caddyfile
  if ! systemctl reload caddy; then
    cp -a "$root/Caddyfile.before-spaceeyes" /etc/caddy/Caddyfile
    systemctl reload caddy || true
    echo 'Caddy reload failed; previous config restored' >&2
    exit 1
  fi
fi
systemctl daemon-reload
systemctl enable spaceeyes-web.service
systemctl enable --now spaceeyes-webhook.service spaceeyes-cache.timer
echo 'SpaceEyes services installed; waiting for a signed release.'
