import { readfile } from 'fs';
import { cursor } from 'uci';
import { reconcile, owned } from './3xui-inbounds-model.uc';

try {
	let input = json(readfile('/dev/stdin'));
	let panel = json(input.panel), request = json(input.request || '{}');
	if (panel.success != true || type(panel.obj) != 'array') die('Не удалось прочитать входящие 3xUI');
	let uci = cursor(), rules = [], zones = [];
	if (!uci.load('firewall')) die('Не удалось прочитать firewall');
	uci.foreach('firewall', 'rule', r => push(rules, r));
	uci.foreach('firewall', 'zone', r => push(zones, r));
	let defaultInput = 'DROP';
	uci.foreach('firewall', 'defaults', r => { defaultInput = r.input || 'DROP'; });
	for (let zone in zones) if (!zone.input) zone.input = defaultInput;
	let state = reconcile(panel.obj, rules, zones);
	// A stale browser may never apply a change to a different rule or inbound.
	let snapshot = sprintf('%J', { state: state, rules: rules, zones: zones });
	if (ARGV[0] == 'status') {
		state.accepted = true;
		state.snapshot = snapshot;
		print(sprintf('%J\n', state));
	} else {
		if (request.snapshot != snapshot) die('Состояние изменилось. Обновите таблицы и повторите действие');
		let action = request.action, target = null;
		if (action == 'delete') {
			for (let orphan in state.orphans) if (orphan.section == request.section) target = orphan;
			if (!target) die('Правило больше не является непривязанным');
			if (!uci.delete('firewall', target.section)) die('Не удалось удалить правило');
		} else {
			for (let row in state.rows)
				if (row.tag == request.tag && row.transport == request.transport) target = row;
			if (!target || !length(action || '') ||
				(target.action != action && !(action == 'close' && length(target.rules)))) die('Это действие больше недоступно');
			if (action != 'open' && action != 'fix' && action != 'close') die('Неизвестное действие');
			for (let rule in target.rules) {
				if (!uci.delete('firewall', rule.section)) die('Не удалось заменить прежнее правило');
			}
			if (action == 'open' || action == 'fix') {
				let section = uci.add('firewall', 'rule');
				if (!section) die('Не удалось создать правило');
				let options = { name: '3xUI: ' + target.tag + ' / ' + target.transport,
					src: 'wan', proto: target.transport, dest_port: '' + target.port,
					target: 'ACCEPT', family: 'any', enabled: '1' };
				for (let key, value in options)
					if (!uci.set('firewall', section, key, value)) die('Не удалось записать правило');
			}
		}
		if (!uci.save('firewall')) die('Не удалось подготовить firewall');
		print('{"accepted":true}\n');
	}
} catch (error) {
	print(sprintf('%J\n', { accepted: false, error: '' + error }));
	exit(1);
}
