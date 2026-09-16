// Run from a staging directory alongside 3xui-inbounds.uc and its model.
// All UCI writes are isolated from /etc/config and /tmp/.uci.
import { readfile, writefile } from 'fs';
let base = '/tmp/nanopi-inbounds-integration';
system('mkdir -p ' + base + '/config ' + base + '/save');
writefile(base + '/config/firewall', "config zone 'wan'\n option name 'wan'\n option input 'REJECT'\n");
let source = readfile('/tmp/nanopi-inbounds-stage/3xui-inbounds.uc');
source = replace(source, 'cursor()', "cursor('" + base + "/config', '" + base + "/save')");
source = replace(source, "'./3xui-inbounds-model.uc'", "'/tmp/nanopi-inbounds-stage/3xui-inbounds-model.uc'");
writefile(base + '/control.uc', source);
let inbounds = [{tag:'test-vless',remark:'Test',protocol:'vless',port:65431,enable:true,settings:'{}',streamSettings:'{}'}];
let count = 0;
function check(ok, msg) { if (!ok) die(msg); count++; }
function call(mode, request) {
	writefile(base + '/input.json', sprintf('%J', {panel:sprintf('%J',{success:true,obj:inbounds}),request:sprintf('%J',request || {})}));
	system('ucode ' + base + '/control.uc ' + mode + ' < ' + base + '/input.json > ' + base + '/output.json');
	return json(readfile(base + '/output.json'));
}
function commit() { check(system('uci -c ' + base + '/config -t ' + base + '/save commit firewall') == 0, 'sandbox commit'); }
let state = call('status');
check(state.accepted && state.rows[0].action == 'open', 'status on actual UCI');
let result = call('prepare',{action:'open',tag:'test-vless',transport:'tcp',snapshot:state.snapshot});
check(result.accepted, 'prepare open'); commit();
state = call('status');
check(state.rows[0].state == 'open', 'persisted own rule detected');
check(!call('prepare',{action:'close',tag:'test-vless',transport:'tcp',snapshot:'stale'}).accepted, 'stale request rejected');
inbounds[0].port=65432;
state=call('status'); check(state.rows[0].state == 'stale', 'changed port');
check(call('prepare',{action:'fix',tag:'test-vless',transport:'tcp',snapshot:state.snapshot}).accepted, 'prepare fix'); commit();
state=call('status'); check(state.rows[0].state=='open' && state.rows[0].rules[0].port=='65432','new port persisted');
inbounds=[];
state=call('status'); check(length(state.orphans)==1,'orphan detected');
check(call('prepare',{action:'delete',section:state.orphans[0].section,snapshot:state.snapshot}).accepted,'prepare orphan delete'); commit();
state=call('status'); check(length(state.orphans)==0,'orphan removed');
inbounds=[{tag:'both',protocol:'shadowsocks',port:65433,enable:true,settings:'{"network":"tcp,udp"}'}];
for(let transport in ['tcp','udp']) {
	state=call('status');
	check(call('prepare',{action:'open',tag:'both',transport:transport,snapshot:state.snapshot}).accepted,'open '+transport); commit();
}
state=call('status'); check(length(state.rows)==2 && state.rows[0].state=='open' && state.rows[1].state=='open','both persisted separately');
check(call('prepare',{action:'close',tag:'both',transport:'tcp',snapshot:state.snapshot}).accepted,'close TCP'); commit();
state=call('status'); check(state.rows[0].state=='closed' && state.rows[1].state=='open','UDP survives TCP close');
let before=readfile(base+'/config/firewall');
check(!call('prepare',{action:'delete',section:'wan',snapshot:state.snapshot}).accepted,'cannot delete foreign section');
check(before==readfile(base+'/config/firewall'),'foreign configuration unchanged');
inbounds[0].port=65435; inbounds[0].enable=false;
state=call('status');
check(call('prepare',{action:'close',tag:'both',transport:'udp',snapshot:state.snapshot}).accepted,'close stale disabled inbound'); commit();
check(length(call('status').rows[1].rules)==0,'stale disabled rule removed');
print(sprintf('PASS: %d isolated UCI integration checks\n',count));
