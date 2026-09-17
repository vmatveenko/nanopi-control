// Pure reconciliation: no credentials, firewall writes or panel changes.
function decode(value) {
	if (type(value) == 'object') return value;
	try { return json(value || '{}'); } catch (e) { return {}; }
}
function words(value) {
	return type(value) == 'array' ? value : split('' + (value || ''), /[ ,]+/);
}
function has(values, value) { return index(values, value) >= 0; }
function transports(inbound) {
	let settings = decode(inbound.settings), stream = decode(inbound.streamSettings);
	let protocol = inbound.protocol, network = stream.network || 'tcp';
	if (has(['tun', 'tunnel', 'dokodemo-door'], protocol)) return [];
	if (has(['hysteria', 'hysteria2', 'wireguard'], protocol)) return ['udp'];
	if (protocol == 'shadowsocks') {
		let networks = words(settings.network || 'tcp,udp');
		return filter(['tcp', 'udp'], p => has(networks, p));
	}
	if (has(['socks', 'mixed'], protocol)) return settings.udp ? ['tcp', 'udp'] : ['tcp'];
	if (protocol == 'http') return ['tcp'];
	if (!has(['vless', 'vmess', 'trojan'], protocol)) return [];
	if (has(['kcp', 'mkcp', 'quic', 'hysteria'], network)) return ['udp'];
	if (has(['tcp', 'raw', 'ws', 'grpc', 'http', 'h2', 'httpupgrade', 'splithttp', 'xhttp'], network)) return ['tcp'];
	return [];
}
function owned(rule) {
	// Keep ownership in the standard name/comment, avoiding unsupported fw4 options.
	if (rule['.name'] == 'nanopi_control_xui_panel') return false;
	let name = rule.name || '', suffix = substr(name, -6);
	let modern = match(name, /^3xUI\.(.+)\.(tcp|udp)$/);
	if (modern) {
		rule.nanopi_tag = modern[1];
		rule.nanopi_transport = modern[2];
		return true;
	}
	if (index(name, '3xUI: ') != 0 || length(name) <= 12 || !has([' / tcp', ' / udp'], suffix)) return false;
	rule.nanopi_tag = substr(name, 6, length(name) - 12);
	rule.nanopi_transport = substr(suffix, 3);
	return true;
}
function enabled(rule) { return rule.enabled != '0' && rule.enabled != 'false'; }
function portMatches(value, port) {
	if (!value) return true;
	for (let part in words(value)) {
		let range = split(part, '-');
		if (length(range) == 1 && +range[0] == port) return true;
		if (length(range) == 2 && +range[0] <= port && port <= +range[1]) return true;
	}
	return false;
}
function candidate(rule, row) {
	let proto = words(rule.proto || 'tcp udp');
	return enabled(rule) && has(['wan', '*'], rule.src) && !rule.dest &&
		(has(proto, row.transport) || has(proto, row.transport == 'tcp' ? '6' : '17') || has(proto, 'all')) &&
		portMatches(rule.dest_port, row.port);
}
function restricted(rule) {
	// Any additional match can narrow an ACCEPT or make an earlier rejection conditional.
	let plain = ['name', 'src', 'dest', 'proto', 'dest_port', 'target', 'family', 'enabled',
		'nanopi_owner', 'nanopi_tag', 'nanopi_transport'];
	for (let key, value in rule) {
		if (index(key, '.') == 0 || has(plain, key) || value == '' || value == null) continue;
		return true;
	}
	return false;
}
function exact(rule, row) {
	return candidate(rule, row) && rule.src == 'wan' && rule.proto == row.transport &&
		('' + rule.dest_port) == ('' + row.port) && rule.target == 'ACCEPT' &&
		(!rule.family || rule.family == 'any') && !restricted(rule);
}
function describe(rule) {
	return { section: rule['.name'], name: rule.name || rule['.name'],
		tag: rule.nanopi_tag || '', transport: rule.nanopi_transport || rule.proto || '',
		port: rule.dest_port || 'Все', enabled: enabled(rule), family: rule.family || 'any' };
}
function reconcile(inbounds, rules, zones) {
	let rows = [], orphans = [], tags = {}, used = {};
	for (let inbound in inbounds) {
		if (inbound.tag) tags[inbound.tag] = (tags[inbound.tag] || 0) + 1;
	}
	for (let inbound in inbounds) {
		if (has(['tun', 'tunnel', 'dokodemo-door'], inbound.protocol)) continue;
		let protocols = transports(inbound), port = +inbound.port;
		let warning = '';
		if (!inbound.tag || tags[inbound.tag] != 1) warning = 'Отсутствует уникальный тег входящего';
		else if (!(port >= 1 && port <= 65535 && port == int(port))) warning = 'Нет поддерживаемого порта';
		else if (!length(protocols)) warning = 'Этот протокол или транспорт пока не поддерживается';
		else if (inbound.listen && !has(['0.0.0.0', '::', '::0', '*'], inbound.listen))
			warning = 'Привязка к конкретному адресу: ' + inbound.listen + '. Проверьте доступность из WAN';
		if (!length(protocols)) protocols = ['—'];
		for (let transport in protocols) {
			let row = { tag: inbound.tag || '', remark: inbound.remark || inbound.tag || 'Без названия',
				protocol: inbound.protocol, port: port, transport: transport,
				enabled: inbound.enable == true, warning: warning, state: 'closed', rules: [], other: [], action: '' };
			for (let rule in rules) {
				if (owned(rule) && rule.nanopi_tag == row.tag && rule.nanopi_transport == transport) {
					push(row.rules, describe(rule)); used[rule['.name']] = true;
				}
			}
			// Evaluate the first potentially matching verdict separately for IPv4 and IPv6.
			let coverage = [], uncertain = [];
			for (let family in ['ipv4', 'ipv6']) {
				let decided = false;
				for (let rule in rules) {
					if (!candidate(rule, row) || (rule.family && rule.family != 'any' && rule.family != family)) continue;
					if (has(['ACCEPT', 'DROP', 'REJECT'], rule.target)) {
						if (restricted(rule)) { push(uncertain, describe(rule)); decided = true; break; }
						if (rule.target == 'ACCEPT') push(coverage, describe(rule));
						else push(uncertain, describe(rule));
						decided = true; break;
					}
				}
				if (!decided) for (let zone in zones) {
					if (zone.name == 'wan' && zone.input == 'ACCEPT')
						push(coverage, { name: 'Политика входящих зоны WAN', section: '', family: family });
				}
			}
			for (let rule in coverage) {
				if (!has(map(row.rules, r => r.section), rule.section) && !has(map(row.other, r => r.section), rule.section)) push(row.other, rule);
			}
			if (length(row.rules)) {
				let own = filter(rules, r => owned(r) && r.nanopi_tag == row.tag && r.nanopi_transport == transport);
				row.state = length(own) == 1 && exact(own[0], row) ? 'open' : 'stale';
				row.action = row.state == 'open' ? 'close' : 'fix';
				if (length(uncertain)) row.warning += ' Есть пересекающееся ограничение firewall; доступ не подтверждён.';
			} else if (length(coverage) == 2 && !length(uncertain)) row.state = 'external';
			else if (length(coverage) || length(uncertain)) {
				row.state = 'limited'; row.other = coverage;
				for (let rule in uncertain) push(row.other, rule);
			} else row.action = 'open';
			if (warning || !row.enabled) { if (row.action != 'close') row.action = ''; }
			push(rows, row);
		}
	}
	for (let rule in rules) if (owned(rule) && !used[rule['.name']]) push(orphans, describe(rule));
	return { rows: rows, orphans: orphans };
}
export { reconcile, owned, exact };
