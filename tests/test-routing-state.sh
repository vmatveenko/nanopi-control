#!/bin/sh
# Isolated UCI configuration; no writes to live firewall or routing tables.
set -e
base="${1:-/usr/libexec/nanopi-control}"
tmp="$(mktemp -d /tmp/nanopi-routing-test.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/config" "$tmp/save"
printf "config nanopi_control 'main'\n" > "$tmp/config/nanopi-control"
NANOPI_XUI_LIBRARY=1
. "$base/3xui-control"
uci() { command uci -c "$tmp/config" -t "$tmp/save" "$@"; }
take_lock() { :; }
runtime=1
routing_is_active() { [ "$runtime" = 1 ]; }
migrate_routing_state
routing_requested
runtime=0
migrate_routing_state
routing_requested || { echo 'Lost desired state after runtime disappearance'; exit 1; }
container_running() { return 0; }
tun_runtime_ready() { return 0; }
ensure_working_token() { WORKING_TOKEN=test; }
ensure_managed_tun() { return 0; }
wait_for_tun() { return 0; }
apply_routing_rules() { applied=1; }
nft() { return 0; }
disable_routing() { applied=0; }
applied=0
set_routing 1 1 >/dev/null
[ "$applied" = 1 ] && routing_requested
set_routing 0 >/dev/null
! routing_requested
[ "$applied" = 0 ]
set_routing 1 1 >/dev/null
[ "$applied" = 0 ] || { echo 'Restore ignored explicit disable'; exit 1; }
! routing_requested
remember_routing 1
container_running() { return 1; }
(set_routing 1 1) > "$tmp/error" 2>/dev/null && exit 1
routing_requested || { echo 'Transient failure erased preference'; exit 1; }
echo 'PASS: migrate active state, persistent preference, restore, explicit disable, transient failure'
