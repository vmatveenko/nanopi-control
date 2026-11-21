#!/usr/bin/env python3
"""Check that DNAT replies bypass only WrtPilot's LAN routing rules."""

from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
control = (ROOT / "root/usr/libexec/nanopi-control/3xui-control").read_text(encoding="utf-8")
worker = (ROOT / "root/usr/libexec/nanopi-control/routing-worker").read_text(encoding="utf-8")


def function(source, name):
    opener = f"{name}() (" if name == "guard" else f"{name}() {{"
    closer = "\n)\n" if name == "guard" else "\n}\n"
    start = source.index(opener)
    end = source.find(closer, start)
    assert end >= 0, name
    return source[start:end]


render = function(control, "render_nft_rules")
guard = function(worker, "guard")
reply = 'ct status dnat ct direction reply'

# Prerouting sees conntrack replies before WrtPilot sets its policy-route bit.
prerouting = render.split('echo " chain prerouting {"', 1)[1].split('echo " }"', 1)[0]
assert 'hook prerouting priority -150' in prerouting
assert prerouting.index(reply) < prerouting.index('ip daddr $cidr return')
assert prerouting.index(reply) < prerouting.index('meta nfproto ipv4 meta mark set')
assert prerouting.index(reply) < prerouting.index('meta nfproto ipv6 meta mark set')
assert 'tcp ' not in prerouting.split(reply, 1)[0].split('echo', 1)[-1]
assert 'udp ' not in prerouting.split(reply, 1)[0].split('echo', 1)[-1]

# The fail-closed guard must let replies reach the regular firewall, while
# retaining the reject for ordinary LAN-originated connections.
assert guard.index(reply) < guard.index('ip daddr $cidr return')
assert guard.index(reply) < guard.index('reject with icmpx type admin-prohibited')
assert 'reject with icmpx type admin-prohibited' in guard

# The optional IPv6 block must also spare DNAT replies and still reject
# other IPv6 forwarding. A return is deliberately not an accept in fw4.
ipv6 = render.split('echo " chain forward {"', 1)[1]
assert ipv6.index(reply) < ipv6.index('ip6 daddr $cidr return')
assert ipv6.index(reply) < ipv6.index('reject with icmpv6 type admin-prohibited')
assert 'iifname \\"$lan\\"' in prerouting
assert 'iifname \\"$lan\\"' in guard
assert 'iifname \\"$lan\\"' in ipv6

# Execute the actual shell generator in both IPv6 modes, with representative
# user exclusions. This catches quoting and conditional-generation mistakes.
bash = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"
generator = function(control, "render_nft_rules") + "\n}\n"
for block in ("0", "1"):
    script = generator + r'''
routing_is_active() { return 1; }
NFT_FAMILY=inet NFT_TABLE=nanopi_xui MARK_VALUE=0x40000000
four=$(mktemp) six=$(mktemp) output=$(mktemp)
trap 'rm -f "$four" "$six" "$output"' EXIT
printf '%s\n' 192.0.2.0/24 > "$four"
printf '%s\n' 2001:db8::/32 > "$six"
render_nft_rules br-lan "$1" "$four" "$six" "$output"
cat "$output"
'''
    result = subprocess.run([bash, "-c", script, "test", block], capture_output=True, text=True, check=True)
    rules = result.stdout
    assert rules.index(reply) < rules.index('ip daddr 192.0.2.0/24 return')
    assert rules.index(reply) < rules.index('meta nfproto ipv4 meta mark set')
    assert ('meta nfproto ipv6 meta mark set' in rules) == (block == "0")
    assert ('reject with icmpv6 type admin-prohibited' in rules) == (block == "1")
    if block == "1":
        assert rules.count(reply) == 2
        assert rules.index(reply, rules.index(reply) + 1) < rules.index('reject with icmpv6 type admin-prohibited')
    else:
        assert rules.count(reply) == 1

print("PASS: DNAT reply bypass precedes marking and guards; ordinary LAN remains protected")
