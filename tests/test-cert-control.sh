#!/bin/sh
# On NanoPi after staging the new scripts. No CA requests and no panel changes.
set -eu
stage=/tmp/nanopi-cert-stage
sed 's|\. /usr/libexec/nanopi-control/3xui-control|. /tmp/nanopi-cert-stage/3xui-control|' "$stage/cert-control" > "$stage/cert-test-library"
set -- library
. "$stage/cert-test-library"
for domain in vpn.example.com a-b.example.net; do cert_valid_domain "$domain" || exit 1; done
for domain in '*.example.com' 'https://example.com' 'example.com:443' '-bad.example.com' 'example..com' '192.0.2.1' 'bad;touch'; do
 if cert_valid_domain "$domain"; then echo "Accepted invalid domain: $domain"; exit 1; fi
done
echo 'PASS: domain validation'
load_panel_endpoint
token="$(read_token_file)"
validate_token "$token"
echo 'PASS: real panel API with updated HTTP client'
backup="$stage/firewall-before-test"
cp -p /etc/config/firewall "$backup"
cleanup_test() { cert_cleanup_network; [ -z "${tls_pid:-}" ] || kill "$tls_pid" 2>/dev/null || true; }
trap cleanup_test EXIT HUP INT TERM
for attempt in 1 2; do
 cert_cleanup_network
 cert_network
 printf 'test-challenge' > "$CERT_RUN/www/.well-known/acme-challenge/probe"
 chmod 644 "$CERT_RUN/www/.well-known/acme-challenge/probe"
 [ "$(curl -fsS --noproxy '*' http://127.0.0.1:18080/.well-known/acme-challenge/probe)" = test-challenge ]
 [ "$(curl -s --noproxy '*' -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/cgi-bin/luci/)" = 404 ]
 curl -fsS --noproxy '*' http://127.0.0.1/ >/dev/null
 nft list table inet nanopi_acme | grep -q 'redirect to :18080'
 cert_cleanup_network
 ! nft list table inet nanopi_acme >/dev/null 2>&1
 ! nft list set inet fw4 nanopi_acme_ifaces >/dev/null 2>&1
 echo "PASS: temporary challenge server, LuCI isolation and retry $attempt"
done
cmp -s /etc/config/firewall "$backup"
echo 'PASS: persistent firewall unchanged'
# Trust and hostname verification for the new local HTTPS API transport.
tlsroot="$stage/tls-test"
mkdir -p "$tlsroot/web/panel/api/inbounds"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 2 \
 -keyout "$tlsroot/key.pem" -out "$tlsroot/cert.pem" -subj /CN=cert-test.invalid \
 -addext subjectAltName=DNS:cert-test.invalid >/dev/null 2>&1
printf '{"success":true,"obj":[]}' > "$tlsroot/web/panel/api/inbounds/list"
chmod 644 "$tlsroot/web/panel/api/inbounds/list"
uhttpd -f -s 127.0.0.1:18443 -C "$tlsroot/cert.pem" -K "$tlsroot/key.pem" -h "$tlsroot/web" -c /dev/null -D >"$tlsroot/server.log" 2>&1 &
tls_pid=$!
sleep 1
PANEL_SCHEME=https; PANEL_DOMAIN=cert-test.invalid; PANEL_PORT=18443; PANEL_KNOWN=1
PANEL_PATH=/; PANEL_TRUST_FILE="$tlsroot/cert.pem"
validate_token fixture-token
PANEL_DOMAIN=wrong.invalid
if validate_token fixture-token; then echo 'TLS accepted wrong hostname'; exit 1; fi
echo 'PASS: HTTPS API verifies trusted certificate and rejects wrong domain'
