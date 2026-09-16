#!/bin/sh
# Uses fake ACME failure and mocked panel activation; never contacts a CA.
set -e
stage=/tmp/nanopi-cert-stage
sed -e 's|\. /usr/libexec/nanopi-control/3xui-control|. /tmp/nanopi-cert-stage/3xui-control|' \
 -e 's|CERT_SELF=/usr/libexec/nanopi-control/cert-control|CERT_SELF=/tmp/nanopi-cert-stage/cert-failure-worker|' \
 -e 's|timeout -k 10 480 /usr/lib/acme/client/acme.sh|timeout -k 10 480 /bin/false|' \
 "$stage/cert-control" > "$stage/cert-failure-worker"
chmod 700 "$stage/cert-failure-worker"
set -- library
. "$stage/cert-failure-worker"
cp -p /etc/config/firewall "$stage/recovery-firewall-before"
for attempt in 1 2; do
 printf 'cert-test.invalid\n' > "$CERT_RUN/request"
 cert_state running 0 'Тест отказа ACME'
 sh "$stage/cert-failure-worker" supervise
 [ "$(jsonfilter -i "$CERT_RUN/state.json" -e '@.phase')" = error ]
 ! nft list table inet nanopi_acme >/dev/null 2>&1
 ! nft list set inet fw4 nanopi_acme_ifaces >/dev/null 2>&1
 echo "PASS: failed ACME attempt $attempt cleans up and permits retry"
done
cmp -s /etc/config/firewall "$stage/recovery-firewall-before"
# Timeout sets stop matching even if a process never runs its cleanup handler.
cert_network
for setname in 'nanopi_acme ingress' 'fw4 nanopi_acme_ifaces'; do
 set -- $setname
 for iface in $(ubus call network.interface.wan status | jsonfilter -e '@.l3_device'); do
  nft delete element inet "$1" "$2" "{ \"$iface\" }"
  nft add element inet "$1" "$2" "{ \"$iface\" timeout 1s }"
 done
done
sleep 2
! nft list set inet nanopi_acme ingress | grep -q 'elements ='
! nft list set inet fw4 nanopi_acme_ifaces | grep -q 'elements ='
cert_cleanup_network
echo 'PASS: abandoned permissions expire independently of worker cleanup'
# Isolate certificate paths and stub panel calls to exercise transaction rollback.
CERT_STORE="$stage/recovery-store"
CERT_JOURNAL="$stage/recovery-transaction.json"
mkdir -p "$CERT_STORE/cert-test.invalid/first" "$CERT_STORE/cert-test.invalid/second"
docker() {
 case "$*" in
  *'-getCert true') printf 'cert: /root/cert/previous.pem\nkey: /root/cert/previous.key\n' ;;
  *) printf '%s\n' "$*" >> "$stage/mock-panel-calls" ;;
 esac
}
load_panel_endpoint() { PANEL_SCHEME=https; PANEL_DOMAIN="${MOCK_DOMAIN:-cert-test.invalid}"; }
read_token_file() { printf test-token; }
validate_token() { return 0; }
wait_panel_endpoint() { return 0; }
cert_activate cert-test.invalid first
[ ! -e "$CERT_JOURNAL" ]
[ "$(readlink "$CERT_STORE/cert-test.invalid/current")" = first ]
MOCK_DOMAIN=wrong.invalid
if cert_activate cert-test.invalid second; then echo 'Accepted wrong HTTPS endpoint'; exit 1; fi
[ -s "$CERT_JOURNAL" ]
cert_restore
[ ! -e "$CERT_JOURNAL" ]
[ "$(readlink "$CERT_STORE/cert-test.invalid/current")" = first ]
grep -q -- '-webCert /root/cert/previous.pem -webCertKey /root/cert/previous.key' "$stage/mock-panel-calls"
exec 9>&-
echo 'PASS: panel activation commit and failed activation rollback preserve previous generation'
