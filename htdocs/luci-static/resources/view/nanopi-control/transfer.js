'use strict';
'require view';
'require rpc';
'require ui';

const callStatus = rpc.declare({
	object: 'nanopi-control',
	method: 'status',
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

function checkRow(ok, title, detail) {
	return E('div', {
		'style': 'display:grid;grid-template-columns:28px minmax(180px,1fr) 2fr;gap:10px;padding:11px 8px;border-bottom:1px solid #ddd;align-items:center'
	}, [
		E('span', { 'style': 'font-size:20px;color:%s'.format(ok ? '#16803a' : '#b42318') }, ok ? '✓' : '×'),
		E('strong', {}, title),
		E('span', { 'style': 'color:#666' }, detail)
	]);
}

function step(number, title, description, active) {
	return E('div', {
		'style': 'border:1px solid %s;border-radius:5px;padding:15px;min-height:110px'.format(active ? '#0066cc' : '#ddd')
	}, [
		E('div', { 'style': 'font-size:13px;color:#666' }, _('Step %d').format(number)),
		E('div', { 'style': 'font-size:18px;font-weight:bold;margin:6px 0' }, title),
		E('div', { 'style': 'color:#666' }, description)
	]);
}

return view.extend({
	load: function() {
		return callStatus();
	},

	render: function(status) {
		status = status || {};

		const root = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('Transfer to internal storage')),
			E('div', { 'class': 'cbi-map-descr' },
				_('Offline assistant for transferring the current OpenWrt installation from an SD card to internal eMMC.'))
		]);

		if (!status.transfer_available) {
			root.appendChild(E('div', { 'class': 'alert-message warning' },
				_('Transfer is unavailable because the system is not running from an SD card or internal eMMC was not detected.')));
			root.appendChild(E('a', {
				'href': L.url('admin/services/nanopi-control/overview'),
				'class': 'btn cbi-button cbi-button-action'
			}, _('Return to overview')));
			return root;
		}

		root.appendChild(E('div', {
			'style': 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:15px;margin:18px 0'
		}, [
			step(1, _('Preflight check'), _('Verify the board, source system and target eMMC.'), true),
			step(2, _('Copy system'), _('Prepare eMMC and transfer the current OpenWrt state.'), false),
			step(3, _('Boot from eMMC'), _('Power off, remove the SD card and start the device.'), false),
			step(4, _('Expand partition'), _('Use all available internal storage after verification.'), false)
		]));

		root.appendChild(E('div', { 'class': 'alert-message warning' }, [
			E('strong', {}, _('No changes are being made yet. ')),
			_('The current development version implements diagnostics and the assistant interface. Destructive copy operations will be enabled only after hardware-level tests.')
		]));

		root.appendChild(E('h3', {}, _('Readiness check')));
		root.appendChild(E('div', { 'class': 'cbi-section' }, [
			checkRow(!!status.supported, _('Device model'), status.model || status.board_name || '-'),
			checkRow(status.boot_medium === 'sd', _('Boot source'), '%s · %s'.format(_('SD card'), status.root_partition || '-')),
			checkRow(!!status.internal_device, _('Target storage'), status.internal_device ? '%s · %s'.format(status.internal_device, formatBytes(status.internal_size)) : _('Not detected')),
			checkRow(status.root_filesystem === 'ext4', _('Filesystem'), status.root_filesystem || _('Unknown'))
		]));

		root.appendChild(E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;margin-top:16px' }, [
			E('button', {
				'class': 'btn cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, function() {
					return callStatus().then(function() { window.location.reload(); });
				})
			}, _('Run check again')),
			E('button', {
				'class': 'btn cbi-button cbi-button-positive important',
				'disabled': true,
				'title': _('Copy engine is not enabled in this version')
			}, _('Start transfer'))
		]));

		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});

