'use strict';
// NanoPi Control: SD to eMMC migration and eMMC maintenance.
'require view';
'require rpc';
'require ui';

const callStatus = rpc.declare({ object: 'nanopi-control', method: 'status', expect: {} });
const callPreflight = rpc.declare({ object: 'nanopi-control', method: 'migration_preflight', expect: {} });
const callMigrationStatus = rpc.declare({ object: 'nanopi-control', method: 'migration_status', expect: {} });
const callMigrationStart = rpc.declare({
	object: 'nanopi-control', method: 'migration_start', params: [ 'confirmation' ], expect: {}
});
const callMigrationExpand = rpc.declare({
	object: 'nanopi-control', method: 'migration_expand', params: [ 'confirmation' ], expect: {}
});
const callMigrationErase = rpc.declare({
	object: 'nanopi-control', method: 'migration_erase', params: [ 'confirmation' ], expect: {}
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
		E('span', { 'style': 'color:#666' }, detail || '-')
	]);
}

function step(number, title, description, state) {
	let color = state === 'done' ? '#16803a' : state === 'active' ? '#0066cc' : '#ddd';
	return E('div', {
		'style': 'border:1px solid %s;border-radius:5px;padding:15px;min-height:110px'.format(color)
	}, [
		E('div', { 'style': 'font-size:13px;color:#666' }, _('Step %d').format(number)),
		E('div', { 'style': 'font-size:18px;font-weight:bold;margin:6px 0;color:%s'.format(state === 'done' ? '#16803a' : '#333') },
			(state === 'done' ? '✓ ' : '') + title),
		E('div', { 'style': 'color:#666' }, description)
	]);
}

function progressBlock(job) {
	let percent = Math.max(0, Math.min(100, Number(job.percent || 0)));
	let color = job.error ? '#b42318' : job.success ? '#16803a' : '#0066cc';
	return E('div', { 'class': 'cbi-section', 'style': 'margin:16px 0' }, [
		E('div', { 'style': 'display:flex;justify-content:space-between;margin-bottom:7px' }, [
			E('strong', {}, job.message || _('Waiting')),
			E('span', {}, '%d%%'.format(percent))
		]),
		E('div', { 'style': 'height:12px;background:#e5e7eb;border-radius:8px;overflow:hidden' }, [
			E('div', { 'style': 'height:100%;width:%d%%;background:%s;transition:width .3s'.format(percent, color) })
		]),
		job.error ? E('div', { 'class': 'alert-message error', 'style': 'margin-top:10px' }, job.error) : ''
	]);
}

return view.extend({
	load: function() {
		return Promise.all([ callStatus(), callPreflight(), callMigrationStatus() ]);
	},

	pollJob: function(container) {
		let timer = window.setInterval(function() {
			callMigrationStatus().then(function(job) {
				container.replaceChildren(progressBlock(job));
				if (!job.running) {
					window.clearInterval(timer);
					window.setTimeout(function() { window.location.reload(); }, 1300);
				}
			});
		}, 1500);
	},

	render: function(data) {
		const status = data[0] || {};
		const preflight = data[1] || {};
		const job = data[2] || {};
		const onSd = !!status.transfer_available;
		const canExpand = !!status.expand_available;
		const migrationStage = status.migration_stage || 'not_started';
		const copied = canExpand || migrationStage === 'target_prepared' ||
			migrationStage === 'partition_expanded_reboot_required' || migrationStage === 'completed';
		const preflightPassed = onSd && !!preflight.ready;

		const root = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('SD to eMMC')),
			E('div', { 'class': 'cbi-map-descr' },
				_('Transfer the current OpenWrt installation, settings and NanoPi Control from the SD card to internal eMMC without downloading another firmware image.'))
		]);

		root.appendChild(E('div', {
			'style': 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:15px;margin:18px 0'
		}, [
			step(1, _('Preflight check'), _('Verify the board, source system and target eMMC.'), preflightPassed || copied ? 'done' : onSd ? 'active' : 'pending'),
			step(2, _('Copy system'), _('Prepare eMMC and transfer the current OpenWrt state.'), copied ? 'done' : preflightPassed ? 'active' : 'pending'),
			step(3, _('Boot from eMMC'), _('Power off, remove the SD card and start the device.'), canExpand || status.migration_stage === 'completed' ? 'done' : copied ? 'active' : 'pending'),
			step(4, _('Expand partition'), _('Use all available internal storage after verification.'), status.migration_stage === 'completed' ? 'done' : canExpand ? 'active' : 'pending')
		]));

		const jobContainer = E('div');
		if (job.phase && job.phase !== 'idle') {
			jobContainer.appendChild(progressBlock(job));
			root.appendChild(jobContainer);
			if (job.running)
				this.pollJob(jobContainer);
		}

		const eraseTarget = status.internal_device || '';
		const eraseAllowed = !!eraseTarget && status.root_device !== eraseTarget && !job.running;
		const eraseConfirmation = E('input', {
			'class': 'cbi-input-text',
			'placeholder': eraseTarget || '/dev/mmcblkX',
			'autocomplete': 'off'
		});
		const eraseButton = E('button', {
			'class': 'btn cbi-button cbi-button-negative important',
			'disabled': true
		}, _('Erase eMMC'));
		eraseConfirmation.addEventListener('input', function() {
			eraseButton.disabled = !eraseAllowed || eraseConfirmation.value !== eraseTarget;
		});
		eraseButton.addEventListener('click', ui.createHandlerFn(this, function() {
			eraseButton.disabled = true;
			return callMigrationErase(eraseConfirmation.value).then(function(result) {
				if (!result.accepted)
					throw new Error(result.error || _('Unable to erase eMMC'));
				window.location.reload();
			}).catch(function(error) {
				ui.addNotification(null, E('p', {}, error.message), 'error');
			});
		}));

		root.appendChild(E('h3', {}, _('eMMC maintenance')));
		root.appendChild(E('div', { 'class': 'cbi-section' }, [
			E('p', {}, _('Erase all partitions and filesystem signatures from %s and reset the SD to eMMC assistant.').format(eraseTarget || _('internal eMMC'))),
			!eraseAllowed ? E('div', { 'class': 'alert-message warning' },
				status.root_device === eraseTarget ? _('The active system device cannot be erased. Boot from the SD card first.') : _('Internal eMMC is unavailable or another storage operation is running.')) : '',
			E('p', {}, _('To confirm erasing the internal storage, enter its device name exactly: %s').format(eraseTarget || '-')),
			E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [ eraseConfirmation, eraseButton ])
		]));

		if (onSd) {
			root.appendChild(E('div', { 'class': 'alert-message warning' }, [
				E('strong', {}, _('Warning: ')),
				_('All existing data on %s will be erased. The SD card is not modified and remains your recovery option.').format(preflight.target || status.internal_device || 'eMMC')
			]));

			root.appendChild(E('h3', {}, _('Readiness check')));
			root.appendChild(E('div', { 'class': 'cbi-section' }, [
				checkRow(!!status.supported, _('Device model'), status.model || status.board_name),
				checkRow(status.boot_medium === 'sd', _('Boot source'), '%s · %s'.format(_('SD card'), status.root_partition || '-')),
				checkRow(!!preflight.layout_ready, _('OpenWrt disk layout'), preflight.layout_ready ? _('Supported') : _('Unexpected layout')),
				checkRow(!!preflight.commands_ready, _('Required utilities'), preflight.commands_ready ? _('Installed') : _('Missing packages')),
				checkRow(!!preflight.docker_ready, _('Docker state'), preflight.docker_ready ? _('Ready') : _('Docker storage must not be mounted')),
				checkRow(!!preflight.size_ready, _('Target capacity'), '%s · %s'.format(preflight.target || '-', formatBytes(preflight.target_size_bytes))),
				checkRow(!!preflight.ready, _('Final result'), preflight.reason || '-')
			]));

			const confirmation = E('input', {
				'class': 'cbi-input-text',
				'placeholder': preflight.target || status.internal_device || '/dev/mmcblkX',
				'autocomplete': 'off'
			});
			const startButton = E('button', {
				'class': 'btn cbi-button cbi-button-negative important',
				'disabled': true
			}, _('Erase eMMC and start transfer'));

			confirmation.addEventListener('input', function() {
				startButton.disabled = !preflight.ready || confirmation.value !== preflight.target;
			});
			startButton.addEventListener('click', ui.createHandlerFn(this, function() {
				startButton.disabled = true;
				return callMigrationStart(confirmation.value).then(function(result) {
					if (!result.accepted)
						throw new Error(result.error || _('Unable to start transfer'));
					window.location.reload();
				}).catch(function(error) {
					ui.addNotification(null, E('p', {}, error.message), 'error');
				});
			}));

			root.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('p', {}, _('To confirm erasing the internal storage, enter its device name exactly: %s').format(preflight.target || '-')),
				E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [ confirmation, startButton ]),
				E('p', { 'style': 'color:#666;margin-top:12px' },
					_('After successful copying, shut the NanoPi down, remove the SD card and boot it again. Do not erase the SD card until eMMC boot is verified.'))
			]));
		}
		else if (canExpand) {
			const expandButton = E('button', {
				'class': 'btn cbi-button cbi-button-positive important'
			}, _('Expand internal storage'));
			expandButton.addEventListener('click', ui.createHandlerFn(this, function() {
				expandButton.disabled = true;
				return callMigrationExpand('EXPAND').then(function(result) {
					if (!result.accepted)
						throw new Error(result.error || _('Unable to start expansion'));
					window.location.reload();
				}).catch(function(error) {
					ui.addNotification(null, E('p', {}, error.message), 'error');
				});
			}));

			root.appendChild(E('div', { 'class': 'alert-message success' },
				_('OpenWrt is now running from internal eMMC. The copied system has been verified and is ready for the final expansion step.')));
			root.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('p', {}, _('This operation extends partition 2 and its ext4 filesystem to all available eMMC space.')),
				expandButton
			]));
		}
		else {
			root.appendChild(E('div', { 'class': 'alert-message warning' },
				_('The transfer assistant is not available in the current boot state.')));
		}

		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
