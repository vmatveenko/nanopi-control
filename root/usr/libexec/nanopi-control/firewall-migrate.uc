import { cursor } from 'uci';
import { owned } from './3xui-inbounds-model.uc';
let uci = cursor(), changed = 0;
uci.foreach('firewall', 'rule', rule => {
	let name;
	if (rule['.name'] == 'nanopi_control_xui_panel' && rule.name == 'WrtPilot 3x-ui panel')
		name = '3xUI.web-panel.tcp';
	else if (owned(rule))
		name = '3xUI.' + rule.nanopi_tag + '.' + rule.nanopi_transport;
	if (name && name != rule.name) {
		if (!uci.set('firewall', rule['.name'], 'name', name)) die('Не удалось переименовать правило');
		changed++;
	}
});
if (changed && !uci.save('firewall')) die('Не удалось сохранить имена правил');
print(changed + '\n');
