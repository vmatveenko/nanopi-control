'use strict';
// NanoPi Control system overview.
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

const callSdExpandInfo = rpc.declare({
	object: 'nanopi-control',
	method: 'sd_expand_info',
	expect: {}
});

const callSdExpandStatus = rpc.declare({
	object: 'nanopi-control',
	method: 'sd_expand_status',
	expect: {}
});

const callSdExpandStart = rpc.declare({
	object: 'nanopi-control',
	method: 'sd_expand_start',
	params: [ 'confirmation' ],
	expect: {}
});

const callModulesStatus = rpc.declare({
	object: 'nanopi-control',
	method: 'modules_status',
	expect: {}
});

const callModulesStart = rpc.declare({
	object: 'nanopi-control',
	method: 'modules_start',
	params: [ 'module', 'action', 'confirmation' ],
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

function table(rows, columns) {
	const t = new L.ui.Table(columns || [ _('Information'), '', '' ], {
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

function sdJobText(text) {
	const translations = {
		'Offline SD expansion queued': 'Офлайн-расширение SD-карты поставлено в очередь',
		'Verifying the offline OpenWrt SD card': 'Проверка отключённой SD-карты с OpenWrt',
		'Saving the current SD partition table': 'Сохранение текущей таблицы разделов SD-карты',
		'Expanding the SD system partition': 'Увеличение системного раздела SD-карты',
		'Checking the offline SD ext4 filesystem': 'Проверка файловой системы ext4',
		'Expanding the offline SD ext4 filesystem': 'Увеличение отключённой файловой системы ext4',
		'Verifying the expanded OpenWrt SD card': 'Финальная проверка расширенной SD-карты',
		'OpenWrt SD card expansion completed.': 'SD-карта с OpenWrt успешно расширена.',
		'SD expansion failed': 'Не удалось увеличить SD-раздел'
	};
	return translations[text] || text || '';
}

function sdProgress(job) {
	let percent = Math.max(0, Math.min(100, Number(job.percent || 0)));
	let color = job.error ? '#b42318' : job.success ? '#16803a' : '#0066cc';
	return E('div', { 'style': 'min-width:280px' }, [
		E('div', { 'style': 'display:flex;justify-content:space-between;gap:12px;margin-bottom:5px' }, [
			E('span', {}, sdJobText(job.message)),
			E('span', {}, '%d%%'.format(percent))
		]),
		E('div', { 'style': 'height:8px;background:#e5e7eb;border-radius:6px;overflow:hidden' }, [
			E('div', { 'style': 'height:100%;width:' + percent + '%;background:' + color + ';transition:width .3s' })
		]),
		job.error ? E('div', { 'style': 'color:#b42318;margin-top:5px' }, sdJobText(job.error)) : ''
	]);
}

function moduleJobProgress(job) {
	let percent = Math.max(0, Math.min(100, Number(job.percent || 0)));
	let color = job.error ? '#b42318' : job.success ? '#16803a' : '#0066cc';
	return E('div', { 'style': 'min-width:260px' }, [
		E('div', { 'style': 'display:flex;justify-content:space-between;gap:12px;margin-bottom:5px' }, [
			E('span', {}, job.message || 'Выполнение операции'),
			E('span', {}, '%d%%'.format(percent))
		]),
		E('div', { 'style': 'height:8px;background:#e5e7eb;border-radius:6px;overflow:hidden' }, [
			E('div', { 'style': 'height:100%;width:' + percent + '%;background:' + color + ';transition:width .3s' })
		]),
		job.error ? E('div', { 'style': 'color:#b42318;margin-top:5px' }, job.error) : ''
	]);
}

return view.extend({
	load: function() {
		return Promise.all([ callStatus(), callBoard(), callInfo(), callInterfaces(), callUpdateStatus(), callSdExpandInfo(), callSdExpandStatus(), callModulesStatus() ]);
	},

	pollModules: function(container) {
		const view = this;
		let timer = window.setInterval(function() {
			callModulesStatus().then(function(state) {
				container.replaceChildren(view.renderModules(state, container));
				if (!state.job || !state.job.running)
					window.clearInterval(timer);
			});
		}, 1000);
	},

	startModuleAction: function(module, action, confirmation, container) {
		const view = this;
		return callModulesStart(module, action, confirmation || '').then(function(result) {
			if (!result.accepted)
				throw new Error(result.error || 'Не удалось запустить операцию');
			container.replaceChildren(view.renderModules({
				modules: [ { id: 'docker', name: 'Docker', dependencies: [] } ],
				job: { running: true, percent: 0, message: action === 'install' ? 'Подготовка установки Docker' : 'Подготовка удаления Docker' }
			}, container));
			view.pollModules(container);
		}).catch(function(error) {
			ui.addNotification(null, E('p', {}, error.message), 'error');
			return callModulesStatus().then(function(state) {
				container.replaceChildren(view.renderModules(state, container));
			});
		});
	},

	renderModules: function(state, container) {
		const view = this;
		const job = state.job || {};
		const rows = (state.modules || []).map(function(module) {
			let status;
			let action;
			let dependencies = (module.dependencies || []).length ? module.dependencies.join(', ') : 'Нет';

			if (job.running) {
				status = moduleJobProgress(job);
				action = E('button', { 'class': 'btn cbi-button cbi-button-action', 'disabled': true }, 'Выполняется…');
			}
			else if (module.installed) {
				status = E('span', { 'style': 'color:#16803a' }, module.service_running
					? 'Установлен и запущен'
					: 'Установлен, служба остановлена');
				action = E('button', { 'class': 'btn cbi-button cbi-button-negative' }, 'Удалить');
				action.disabled = !module.can_remove;
				action.addEventListener('click', ui.createHandlerFn(view, function() {
					ui.showModal('Удаление Docker', [
						E('p', {}, 'Пакеты Docker будут удалены. Данные контейнеров в /opt/docker сохранятся.'),
						E('div', { 'class': 'right' }, [
							E('button', { 'class': 'btn', 'click': ui.hideModal }, 'Отмена'),
							' ',
							E('button', {
								'class': 'btn cbi-button cbi-button-negative important',
								'click': ui.createHandlerFn(view, function() {
									ui.hideModal();
									return view.startModuleAction('docker', 'remove', 'REMOVE_DOCKER', container);
								})
							}, 'Удалить')
						])
					]);
				}));
			}
			else {
				status = job.error
					? E('span', { 'style': 'color:#b42318' }, job.error)
					: E('span', {}, 'Не установлен');
				action = E('button', { 'class': 'btn cbi-button cbi-button-action' }, 'Установить');
				action.disabled = !module.can_install;
				if (module.can_install) {
					action.addEventListener('click', ui.createHandlerFn(view, function() {
						action.disabled = true;
						return view.startModuleAction('docker', 'install', '', container);
					}));
				}
			}

			if (module.blocked_reason)
				status = E('span', { 'style': 'color:#d97706' }, module.blocked_reason);

			return [ module.name || module.id, status, dependencies, action ];
		});

		return table(rows, [ 'Модуль', 'Состояние', 'Зависимости', 'Действие' ]);
	},

	pollSdExpansion: function(container) {
		let timer = window.setInterval(function() {
			callSdExpandStatus().then(function(job) {
				container.replaceChildren(sdProgress(job));
				if (!job.running) {
					window.clearInterval(timer);
					window.setTimeout(function() { window.location.reload(); }, 1300);
				}
			});
		}, 1000);
	},

	renderSdExpansion: function(expansion, job, container) {
		const view = this;
		if (job.running) {
			window.setTimeout(function() { view.pollSdExpansion(container); }, 0);
			return sdProgress(job);
		}
		if (!expansion.available)
			return E('span', { 'style': 'color:#16803a' }, 'Расширение не требуется');

		const button = E('button', {
			'class': 'cbi-button cbi-button-action important'
		}, 'Увеличить до %s'.format(formatBytes(expansion.target_size_bytes)));
		button.addEventListener('click', ui.createHandlerFn(this, function() {
			button.disabled = true;
			return callSdExpandStart('EXPAND_SD').then(function(result) {
				if (!result.accepted)
					throw new Error(result.error || 'Не удалось запустить расширение SD-раздела');
				container.replaceChildren(sdProgress({ percent: 0, running: true, message: 'Offline SD expansion queued' }));
				view.pollSdExpansion(container);
			}).catch(function(error) {
				ui.addNotification(null, E('p', {}, error.message), 'error');
				button.disabled = false;
			});
		}));
		return button;
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
		const sdExpansion = data[5] || {};
		const sdJob = data[6] || {};
		const modules = data[7] || {};
		const internalPresent = !!status.internal_device;
		const rootBytes = Number(status.root_total_kib || 0) * 1024;
		const rootUsedBytes = Number(status.root_used_kib || 0) * 1024;
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

		root.appendChild(E('h3', {}, _('System information')));
		const sdExpansionHint = status.boot_medium === 'sd' &&
			Number(sdExpansion.target_size_bytes || 0) > 0 &&
			rootBytes < Number(sdExpansion.target_size_bytes) * 0.9
			? E('span', { 'style': 'color:#d97706' },
				'Для увеличения загрузитесь с eMMC и после загрузки вставьте SD-карту.')
			: '';
		const bootSource = status.boot_medium === 'sd'
			? E('span', {}, [
				E('span', { 'style': 'color:#b42318' }, mediumLabel(status.boot_medium)),
				' · ' + (status.root_device || '-')
			])
			: '%s · %s'.format(mediumLabel(status.boot_medium), status.root_device || '-');
		const systemRows = [
			[ _('Model'), board.model || status.model || '-', '' ],
			[ _('Board'), board.board_name || status.board_name || '-', '' ],
			[ _('OpenWrt version'), release.description || release.version || '-', '' ],
			[ _('Kernel version'), board.kernel || '-', '' ],
			[ _('NanoPi Control version'), status.module_version || '-', '' ],
			[ _('Boot source'), bootSource, '' ],
			[ _('Internal storage'), internalPresent ? '%s · %s'.format(status.internal_device, formatBytes(status.internal_size)) : _('Not detected'), '' ],
			[ _('System partition'), '%s · %s · %s занято из %s · %s свободно'.format(status.root_partition || '-', status.root_filesystem || '-', formatBytes(rootUsedBytes), formatBytes(rootBytes), formatBytes(freeBytes)), sdExpansionHint ],
			[ _('Active IPv4 addresses'), activeAddresses(interfaces), '' ],
			[ _('Memory'), '%s / %s'.format(formatBytes(memory.available || memory.free), formatBytes(memory.total)), '' ]
		];
		if (sdExpansion.eligible) {
			const sdActionContainer = E('div');
			sdActionContainer.appendChild(this.renderSdExpansion(sdExpansion, sdJob, sdActionContainer));
			systemRows.splice(systemRows.length - 2, 0, [
				'SD-карта с OpenWrt',
				'%s · ext4 · %s · целевой размер %s'.format(sdExpansion.partition || '-', formatBytes(sdExpansion.filesystem_size_bytes), formatBytes(sdExpansion.target_size_bytes)),
				sdActionContainer
			]);
		}
		root.appendChild(table(systemRows));

		root.appendChild(E('h3', { 'style': 'margin-top:20px' }, 'Модули'));
		const modulesContainer = E('div');
		modulesContainer.appendChild(this.renderModules(modules, modulesContainer));
		root.appendChild(modulesContainer);
		if (modules.job && modules.job.running)
			window.setTimeout(this.pollModules.bind(this, modulesContainer), 0);

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
