'use strict';
'require view';
'require rpc';
'require ui';

const callStatus = rpc.declare({
	object: 'nanopi-control',
	method: 'status',
	expect: {}
});

const callBoard = rpc.declare({
	object: 'system',
	method: 'board',
	expect: {}
});

const callInfo = rpc.declare({
	object: 'system',
	method: 'info',
	expect: {}
});

const callInterfaces = rpc.declare({
	object: 'network.interface',
	method: 'dump',
	expect: { interface: [] }
});

const callUpdateStatus = rpc.declare({
	object: 'nanopi-control',
	method: 'update_status',
	expect: {}
});

const callUpdateCheck = rpc.declare({
	object: 'nanopi-control',
	method: 'update_check',
	expect: {}
});

const callUpdateStart = rpc.declare({
	object: 'nanopi-control',
	method: 'update_start',
	expect: {}
});

function formatBytes(bytes) {
	let value = Number(bytes || 0);
	let units = [ _('B'), _('KiB'), _('MiB'), _('GiB'), _('TiB') ];
	let unit = 0;

	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}

	return '%s %s'.format(value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1), units[unit]);
}

function mediumLabel(medium) {
	switch (medium) {
	case 'sd': return _('SD card');
	case 'emmc': return _('Internal eMMC');
	case 'mmc': return _('Non-removable MMC');
	default: return _('Unknown');
	}
}

function badge(title, value, detail, color) {
	return E('div', {
		'style': 'border:1px solid #ddd;border-radius:5px;padding:15px;min-height:96px;display:flex;flex-direction:column;justify-content:center'
	}, [
		E('div', { 'style': 'font-size:14px;color:#666;margin-bottom:8px' }, title),
		E('div', { 'style': 'font-size:21px;font-weight:bold;color:%s'.format(color || '#333') }, value),
		E('div', { 'style': 'font-size:13px;color:#666;margin-top:6px' }, detail || '')
	]);
}

function table(rows) {
	const t = new L.ui.Table([ _('Information'), '' ], {
		'style': 'width:100%;table-layout:auto'
	});
	t.update(rows);
	return t.render();
}

function activeAddresses(interfaces) {
	let result = [];

	for (const iface of interfaces || []) {
		if (!iface.up)
			continue;

		for (const addr of iface['ipv4-address'] || [])
			result.push('%s: %s/%s'.format(iface.interface, addr.address, addr.mask));
	}

	return result.length ? result.join(', ') : _('No active IPv4 addresses');
}

return view.extend({
	load: function() {
		return Promise.all([ callStatus(), callBoard(), callInfo(), callInterfaces(), callUpdateStatus() ]);
	},

	renderUpdate: function(update, container) {
		const view = this;
		const checking = update.status === 'checking' || update.status === 'downloading' || update.status === 'verifying' || update.status === 'installing';
		const available = !!update.update_available;
		const color = update.error ? '#b42318' : available ? '#d97706' : update.status === 'current' || update.status === 'complete' ? '#16803a' : '#0066cc';

		const checkButton = E('button', {
			'class': 'btn cbi-button cbi-button-action'
		}, checking ? _('Checking…') : _('Check for updates'));
		checkButton.disabled = checking;
		checkButton.addEventListener('click', ui.createHandlerFn(this, function() {
			checkButton.disabled = true;
			return callUpdateCheck().then(function(state) {
				container.replaceChildren(view.renderUpdate(state, container));
			}).catch(function(error) {
				ui.addNotification(null, E('p', {}, error.message), 'error');
				checkButton.disabled = false;
			});
		}));

		const buttons = [ checkButton ];
		if (available) {
			const updateButton = E('button', {
				'class': 'btn cbi-button cbi-button-positive important'
			}, _('Update to %s').format(update.latest_version || update.tag || '-'));
			updateButton.disabled = checking;
			updateButton.addEventListener('click', ui.createHandlerFn(this, function() {
				updateButton.disabled = true;
				return callUpdateStart().then(function(result) {
					if (!result.accepted)
						throw new Error(result.error || _('Unable to start update'));
					let timer = window.setInterval(function() {
						callUpdateStatus().then(function(state) {
							container.replaceChildren(view.renderUpdate(state, container));
							if (state.status === 'complete' || state.status === 'error') {
								window.clearInterval(timer);
								if (state.status === 'complete')
									window.setTimeout(function() { window.location.reload(); }, 1800);
							}
						});
					}, 1500);
				}).catch(function(error) {
					ui.addNotification(null, E('p', {}, error.message), 'error');
					updateButton.disabled = false;
				});
			}));
			buttons.push(updateButton);
		}

		return E('div', { 'class': 'cbi-section' }, [
			E('div', { 'style': 'display:grid;grid-template-columns:minmax(180px,1fr) 2fr;gap:10px;padding:9px 0' }, [
				E('strong', {}, _('Installed version')),
				E('span', {}, update.current_version || '-')
			]),
			E('div', { 'style': 'display:grid;grid-template-columns:minmax(180px,1fr) 2fr;gap:10px;padding:9px 0' }, [
				E('strong', {}, _('Latest release')),
				E('span', { 'style': 'color:%s;font-weight:%s'.format(color, available ? 'bold' : 'normal') }, update.latest_version || _('Not checked'))
			]),
			E('p', { 'style': 'color:%s'.format(color) }, update.error || update.message || _('Updates have not been checked')),
			E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap' }, buttons)
		]);
	},

	render: function(data) {
		const status = data[0] || {};
		const board = data[1] || {};
		const info = data[2] || {};
		const interfaces = data[3] || [];
		const update = data[4] || {};
		const internalPresent = !!status.internal_device;
		const transferReady = !!status.transfer_available;
		const expansionReady = !!status.expand_available;
		const rootBytes = Number(status.root_total_kib || 0) * 1024;
		const freeBytes = Number(status.root_available_kib || 0) * 1024;
		const memory = info.memory || {};
		const release = board.release || {};

		const root = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('NanoPi Control - Overview')),
			E('div', { 'class': 'cbi-map-descr' },
				_('Current information about the NanoPi, its boot source and internal storage.'))
		]);

		if (!status.supported) {
			root.appendChild(E('div', { 'class': 'alert-message warning' },
				_('This device is not recognized as a FriendlyElec NanoPi R5S. Migration operations are unavailable.')));
		}

		root.appendChild(E('div', {
			'style': 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:15px;margin:18px 0'
		}, [
			badge(_('Boot source'), mediumLabel(status.boot_medium), status.root_partition || '-', status.boot_medium === 'sd' ? '#d97706' : '#16803a'),
			badge(_('Internal storage'), internalPresent ? _('Detected') : _('Not detected'), internalPresent ? '%s · %s'.format(status.internal_device, formatBytes(status.internal_size)) : '-', internalPresent ? '#16803a' : '#b42318'),
			badge(_('System partition'), formatBytes(rootBytes), _('Available: %s').format(formatBytes(freeBytes)), '#0066cc'),
			badge(_('Transfer'), transferReady ? _('Available') : expansionReady ? _('Continue') : _('Not required'), transferReady ? _('The system is running from an SD card') : expansionReady ? _('Internal storage expansion is pending') : _('The system is not running from an SD card'), transferReady || expansionReady ? '#d97706' : '#16803a')
		]));

		if (transferReady || expansionReady) {
			root.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('p', {}, transferReady ? _('The system is running from an SD card and can be prepared for transfer to internal eMMC.') : _('The system is running from eMMC and is ready for final storage expansion.')),
				E('a', {
					'href': L.url('admin/services/nanopi-control/transfer'),
					'class': 'btn cbi-button cbi-button-action important'
				}, _('Open transfer assistant'))
			]));
		}

		root.appendChild(E('h3', {}, _('System information')));
		root.appendChild(table([
			[ _('Model'), board.model || status.model || '-' ],
			[ _('Board'), board.board_name || status.board_name || '-' ],
			[ _('OpenWrt version'), release.description || release.version || '-' ],
			[ _('Kernel version'), board.kernel || '-' ],
			[ _('NanoPi Control version'), status.module_version || '-' ],
			[ _('Active IPv4 addresses'), activeAddresses(interfaces) ],
			[ _('Memory'), '%s / %s'.format(formatBytes(memory.available || memory.free), formatBytes(memory.total)) ]
		]));

		root.appendChild(E('h3', { 'style': 'margin-top:20px' }, _('Storage information')));
		root.appendChild(table([
			[ _('Root device'), status.root_device || '-' ],
			[ _('Root partition'), status.root_partition || '-' ],
			[ _('Root filesystem'), status.root_filesystem || '-' ],
			[ _('Root partition size'), formatBytes(rootBytes) ],
			[ _('Root partition available'), formatBytes(freeBytes) ],
			[ _('SD card'), status.sd_device ? '%s · %s'.format(status.sd_device, formatBytes(status.sd_size)) : _('Not detected') ],
			[ _('Internal eMMC'), internalPresent ? '%s · %s'.format(status.internal_device, formatBytes(status.internal_size)) : _('Not detected') ]
		]));

		root.appendChild(E('h3', { 'style': 'margin-top:20px' }, _('NanoPi Control updates')));
		const updateContainer = E('div');
		updateContainer.appendChild(this.renderUpdate(update, updateContainer));
		root.appendChild(updateContainer);

		root.appendChild(E('div', { 'style': 'margin-top:16px' }, [
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, function() {
					return callStatus().then(function() { window.location.reload(); });
				})
			}, _('Refresh'))
		]));

		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
