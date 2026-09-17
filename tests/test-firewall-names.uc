import { readfile, writefile } from 'fs';
import { cursor } from 'uci';
let base = '/tmp/nanopi-firewall-names-test';
system('mkdir -p ' + base + '/config ' + base + '/save');
let fixture = "config rule 'nanopi_control_xui_panel'\n option name 'WrtPilot 3x-ui panel'\n option src 'wan'\n option proto 'tcp'\n option dest_port '4053'\n option target 'ACCEPT'\n" +
 "config rule 'inbound'\n option name '3xUI: tag.with.dots / udp'\n option proto 'udp'\n option dest_port '443'\n option enabled '0'\n" +
 "config rule 'foreign'\n option name 'My manual rule'\n option dest_port '1234'\n";
writefile(base + '/config/firewall', fixture);
let source = readfile('/tmp/nanopi-restore-stage/firewall-migrate.uc');
source = replace(source, 'cursor()', "cursor('" + base + "/config', '" + base + "/save')");
source = replace(source, "'./3xui-inbounds-model.uc'", "'/tmp/nanopi-restore-stage/3xui-inbounds-model.uc'");
writefile(base + '/migrate.uc', source);
if (system('ucode ' + base + '/migrate.uc > ' + base + '/count') != 0) die('migration failed');
let uci = cursor(base + '/config', base + '/save');
if (uci.get('firewall','nanopi_control_xui_panel','name') != '3xUI.web-panel.tcp') die('panel name');
if (uci.get('firewall','inbound','name') != '3xUI.tag.with.dots.udp') die('inbound name');
if (uci.get('firewall','inbound','enabled') != '0' || uci.get('firewall','inbound','dest_port') != '443') die('changed permission');
if (uci.get('firewall','foreign','name') != 'My manual rule') die('foreign rule changed');
if (!uci.commit('firewall')) die('sandbox commit');
if (system('ucode ' + base + '/migrate.uc > ' + base + '/count') != 0 || trim(readfile(base + '/count')) != '0') die('not idempotent');
print('PASS: legacy names migrate once, panel and dotted tag recognized, foreign rules and permissions preserved\n');
