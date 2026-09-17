// Run on OpenWrt: ucode test-3xui-inbounds.uc (model alongside this file).
import { reconcile } from './3xui-inbounds-model.uc';
let count = 0;
function check(ok, message) { if (!ok) die(message); count++; }
function inbound(tag, protocol, port, settings, stream) {
	return { tag: tag, remark: tag, protocol: protocol, port: port, enable: true,
		settings: settings || {}, streamSettings: stream || {} };
}
function rule(tag, transport, port, section) {
	return { '.name': section || 'test', name: '3xUI: ' + tag + ' / ' + transport, src: 'wan', proto: transport,
		dest_port: '' + port, target: 'ACCEPT', family: 'any', enabled: '1' };
}
let a = inbound('vless', 'vless', 443), b = inbound('hy', 'hysteria', 443);
let result = reconcile([a, b], [rule('vless', 'tcp', 443)], []);
check(result.rows[0].state == 'open', 'own TCP open');
check(result.rows[1].state == 'closed' && result.rows[1].transport == 'udp', 'UDP independent');
let c = inbound('second', 'vless', 443);
result = reconcile([a, c], [rule('vless', 'tcp', 443)], []);
check(result.rows[1].state == 'external' && result.rows[1].action == '', 'same socket external and immutable');
a.port = 8443;
result = reconcile([a], [rule('vless', 'tcp', 443)], []);
check(result.rows[0].state == 'stale' && result.rows[0].action == 'fix', 'changed port fix');
result = reconcile([], [rule('deleted', 'tcp', 443)], []);
check(length(result.orphans) == 1, 'deleted inbound orphan');
let manual = { '.name': 'manual', name: 'Manual', src: 'wan', target: 'ACCEPT', proto: 'tcp udp', dest_port: '400-9000' };
result = reconcile([a, b], [manual], []);
check(result.rows[0].state == 'external' && result.rows[1].state == 'external', 'manual combined range');
check(length(result.orphans) == 0, 'manual never orphan');
manual.src_ip = '192.0.2.0/24';
result = reconcile([a], [manual], []);
check(result.rows[0].state == 'limited' && result.rows[0].action == '', 'restricted source not fully open');
delete manual.src_ip;
manual.family = 'ipv4';
check(reconcile([a], [manual], []).rows[0].state == 'limited', 'IPv4 only is partial');
manual.family = 'any'; manual.dest = 'lan';
check(reconcile([a], [manual], []).rows[0].state == 'closed', 'forward rule not host input');
delete manual.dest; manual.enabled = '0';
check(reconcile([a], [manual], []).rows[0].state == 'closed', 'disabled ignored');
let ss = inbound('ss', 'shadowsocks', 9000, { network: 'tcp,udp' });
result = reconcile([ss], [], []);
check(length(result.rows) == 2 && result.rows[0].transport != result.rows[1].transport, 'two transports separate');
let tun = inbound('tun', 'tun', 0);
check(length(reconcile([tun], [], []).rows) == 0, 'TUN excluded');
let kcp = inbound('kcp', 'vless', 5000, {}, { network: 'kcp' });
check(reconcile([kcp], [], []).rows[0].transport == 'udp', 'VLESS KCP uses UDP');
a.enable = false;
check(reconcile([a], [], []).rows[0].action == '', 'disabled inbound cannot open');
a.enable = true; a.listen = '127.0.0.1';
check(reconcile([a], [], []).rows[0].action == '', 'loopback cannot open');
delete a.listen;
check(reconcile([a,a], [], []).rows[0].action == '', 'duplicate tags cannot mutate');
check(reconcile([a], [], [{name:'wan', input:'ACCEPT'}]).rows[0].state == 'external', 'WAN input accept');
let reject = { '.name':'reject', src:'wan', proto:'tcp', target:'REJECT', dest_port:'8443' };
check(reconcile([a], [reject, rule('vless','tcp',8443)], []).rows[0].warning != '', 'earlier reject detected');
result = reconcile([a], [rule('vless','tcp',8443,'one'), rule('vless','tcp',8443,'two')], []);
check(result.rows[0].state == 'stale', 'duplicate owned repair');
result = reconcile([b], [rule('hy','tcp',443)], []);
check(length(result.orphans) == 1, 'removed transport orphan');
let dotted = rule('tag.with.dots', 'tcp', 443);
dotted.name = '3xUI.tag.with.dots.tcp';
check(reconcile([inbound('tag.with.dots','vless',443)], [dotted], []).rows[0].state == 'open', 'dotted tags');
let panelRule = rule('web-panel','tcp',443,'nanopi_control_xui_panel');
panelRule.name = '3xUI.web-panel.tcp';
check(length(reconcile([], [panelRule], []).orphans) == 0, 'panel never becomes inbound orphan');
print(sprintf('PASS: %d inbound reconciliation checks\n', count));
