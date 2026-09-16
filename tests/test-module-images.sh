#!/bin/sh
set -eu
base="${1:-/usr/libexec/nanopi-control}"
tmp="$(mktemp -d /tmp/module-images-test.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
[ "$(sh "$base/module-images" resolve 3x-ui 3.7.0)" = ghcr.io/mhsanaei/3x-ui:3.7.0 ]
[ "$(sh "$base/module-images" resolve caddy latest)" = caddy:2-alpine ]
[ "$(sh "$base/module-images" resolve vaultwarden '')" = vaultwarden/server:latest ]
for tag in '../latest' 'evil/repo:latest' '3.7.0;id' '$(id)' '-latest' '3.7.0-rc1'; do
	if sh "$base/module-images" resolve 3x-ui "$tag"; then echo 'Invalid tag accepted'; exit 1; fi
done
if sh "$base/module-images" resolve unknown latest; then exit 1; fi
cat > "$tmp/hub.json" <<'EOF'
{"results":[
 {"name":"2.10.2-alpine","images":[{"architecture":"arm64","os":"linux"}]},
 {"name":"2.11.0-alpine","images":[{"architecture":"amd64","os":"linux"}]},
 {"name":"2.12.0-alpine","images":[{"architecture":"arm64","os":"windows"}]},
 {"name":"builder-alpine","images":[{"architecture":"arm64","os":"linux"}]}
]}
EOF
[ "$(ucode "$base/module-versions.uc" caddy "$tmp/hub.json")" = 2.10.2-alpine ]
printf '%s\n' '{"tags":["latest","v3.7.0","3.7.0","3.8.0-rc1","bad;id"]}' > "$tmp/ghcr.json"
[ "$(ucode "$base/module-versions.uc" ghcr "$tmp/ghcr.json")" = 3.7.0 ]
printf '%s\n' '{"message":"rate limited"}' > "$tmp/error.json"
if ucode "$base/module-versions.uc" ghcr "$tmp/error.json"; then exit 1; fi
echo 'PASS: fixed image repositories, invalid tags rejected, stable tags and ARM64 filtering, registry error rejected'
