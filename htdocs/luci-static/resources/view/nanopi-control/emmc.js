'use strict';
// NanoPi Control: persistent four-stage SD to eMMC workflow and actions.
'require view';
'require rpc';
'require ui';

const callStatus = rpc.declare({ object: 'nanopi-control', method: 'status', expect: {} });
const callPreflight = rpc.declare({ object: 'nanopi-control', method: 'migration_preflight', expect: {} });
const callMigrationStatus = rpc.declare({ object: 'nanopi-control', method: 'migration_status', expect: {} });
const callMigrationStart = rpc.declare({
	object: 'nanopi-control', method: 'migration_start', params: [ 'confirmation' ], expect: {}
});
const callMigrationConfirmBoot = rpc.declare({
	object: 'nanopi-control', method: 'migration_confirm_boot', params: [ 'confirmation' ], expect: {}
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

function preflightReason(reason) {
	switch (reason) {
	case 'Ready': return _('Ready');
	case 'Unsupported device': return _('Unsupported device');
	case 'The system is not running from SD or eMMC is unavailable': return _('The system is not running from SD or eMMC is unavailable');
	case 'Only ext4 installations are supported': return _('Only ext4 installations are supported');
	case 'Source and target devices are invalid': return _('Source and target devices are invalid');
	case 'Required system utilities are missing': return _('Required system utilities are missing');
	case 'Unexpected OpenWrt partition layout': return _('Unexpected OpenWrt partition layout');
	case 'Internal eMMC is too small for the current system': return _('Internal eMMC is too small for the current system');
	case 'Docker data is stored on a separate mounted filesystem': return _('Docker data is stored on a separate mounted filesystem');
	default: return reason || '-';
	}
}

function step(number, title, description, state, action) {
	let color = state === 'done' ? '#16803a' : state === 'active' ? '#0066cc' : '#ddd';
	return E('div', {
		'id': 'nanopi-migration-step-%d'.format(number),
		'data-state': state,
		'style': 'border:1px solid %s;border-radius:5px;padding:12px 14px;height:140px;box-sizing:border-box;display:flex;flex-direction:column'.format(color)
	}, [
		E('div', { 'style': 'min-height:32px;display:flex;justify-content:space-between;gap:8px;align-items:flex-start' }, [
			E('div', { 'style': 'font-size:13px;color:#666;padding-top:6px' }, _('Step %d').format(number)),
			action || ''
		]),
		E('div', {
			'class': 'nanopi-migration-step-title',
			'data-title': title,
			'style': 'font-size:18px;font-weight:bold;margin:6px 0;color:%s'.format(state === 'done' ? '#16803a' : '#333')
		},
			(state === 'done' ? '✓ ' : '') + title),
		E('div', { 'style': 'color:#666;line-height:1.35' }, description)
	]);
}

function setStepState(number, state) {
	let card = document.getElementById('nanopi-migration-step-%d'.format(number));
	if (!card)
		return;

	let title = card.querySelector('.nanopi-migration-step-title');
	let color = state === 'done' ? '#16803a' : state === 'active' ? '#0066cc' : '#ddd';
	card.dataset.state = state;
	card.style.borderColor = color;
	if (title) {
		title.style.color = state === 'done' ? '#16803a' : '#333';
		title.textContent = (state === 'done' ? '✓ ' : '') + title.dataset.title;
	}
}

function updateStageCards(stage) {
	let copied = stage === 'copy_completed' || stage === 'boot_confirmed' ||
		stage === 'partition_expanded_reboot_required' || stage === 'expansion_completed';
	let bootConfirmed = stage === 'boot_confirmed' ||
		stage === 'partition_expanded_reboot_required' || stage === 'expansion_completed';
	let expansionCompleted = stage === 'expansion_completed';

	setStepState(1, copied ? 'done' : 'active');
	setStepState(2, copied ? 'done' : 'active');
	setStepState(3, bootConfirmed ? 'done' : copied ? 'active' : 'pending');
	setStepState(4, expansionCompleted ? 'done' : bootConfirmed ? 'active' : 'pending');
}

function jobText(text) {
	const translations = {
		'Waiting': 'Ожидание',
		'Operation queued': 'Операция поставлена в очередь',
		'Repeating safety checks': 'Повторная проверка безопасности',
		'Unmounting old target partitions': 'Отключение старых разделов eMMC',
		'Creating a temporary eMMC partition layout': 'Создание временной разметки eMMC',
		'Copying NanoPi bootloader and boot partition': 'Копирование загрузчика NanoPi и загрузочного раздела',
		'Verifying boot partition': 'Проверка загрузочного раздела',
		'Creating ext4 system filesystem': 'Создание системной файловой системы ext4',
		'Copying the current OpenWrt installation': 'Копирование текущей системы OpenWrt',
		'Temporarily stopping Docker for a consistent copy': 'Временная остановка Docker для целостного копирования',
		'Running final synchronization': 'Финальная синхронизация',
		'Checking copied filesystem': 'Проверка скопированной файловой системы',
		'Saving completed copy state on eMMC': 'Сохранение состояния завершённого копирования',
		'Restarting Docker on the SD system': 'Перезапуск Docker в системе на SD-карте',
		'Transfer completed. Power off the NanoPi, remove the SD card and boot from eMMC.': 'Перенос завершён. Выключите NanoPi, извлеките SD-карту и загрузитесь с eMMC.',
		'Verifying the internal eMMC target': 'Проверка внутренней eMMC',
		'Erasing eMMC partition table and filesystem signatures': 'Очистка таблицы разделов и сигнатур файловых систем eMMC',
		'Erasing backup partition metadata': 'Очистка резервных метаданных разделов',
		'Internal eMMC was erased and the SD to eMMC assistant was reset.': 'Внутренняя eMMC очищена, мастер переноса сброшен.',
		'Verifying that OpenWrt is running from internal eMMC': 'Проверка загрузки OpenWrt со внутренней eMMC',
		'Boot from internal eMMC was confirmed.': 'Загрузка со внутренней eMMC подтверждена.',
		'Verifying that OpenWrt is running from eMMC': 'Проверка загрузки OpenWrt с eMMC',
		'Expanding the eMMC partition': 'Расширение раздела eMMC',
		'Partition table was updated. Reboot once, then return to finish filesystem expansion.': 'Таблица разделов обновлена. Перезагрузите NanoPi и вернитесь для завершения расширения.',
		'Expanding the ext4 filesystem': 'Расширение файловой системы ext4',
		'Internal storage expansion completed.': 'Расширение внутреннего накопителя завершено.',
		'Unable to save copy verification state': 'Не удалось сохранить состояние проверки копии',
		'Unable to save completed copy state': 'Не удалось сохранить состояние завершённого копирования',
		'Unable to save boot confirmation state': 'Не удалось сохранить подтверждение загрузки с eMMC',
		'Unable to save partition expansion state': 'Не удалось сохранить состояние расширения раздела',
		'Unable to save completed expansion state': 'Не удалось сохранить состояние завершённого расширения',
		'Operation failed': 'Операция завершилась с ошибкой'
	};
	return translations[text] || text || '';
}

function progressBlock(job) {
	let percent = Math.max(0, Math.min(100, Number(job.percent || 0)));
	let color = job.error ? '#b42318' : job.success ? '#16803a' : '#0066cc';
	return E('div', { 'class': 'cbi-section', 'style': 'margin:16px 0' }, [
		E('div', { 'style': 'display:flex;justify-content:space-between;margin-bottom:7px' }, [
			E('strong', {}, jobText(job.message || 'Waiting')),
			E('span', {}, '%d%%'.format(percent))
		]),
		E('div', { 'style': 'height:12px;background:#e5e7eb;border-radius:8px;overflow:hidden' }, [
			E('div', { 'style': 'height:100%;width:' + percent + '%;background:' + color + ';transition:width .3s' })
		]),
		job.error ? E('div', { 'class': 'alert-message error', 'style': 'margin-top:10px' }, jobText(job.error)) : ''
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
					callStatus().then(function(status) {
						let stage = status.migration_stage || 'not_started';
						if (job.success && job.phase === 'complete' && status.boot_medium === 'sd' && stage === 'copy_completed') {
							updateStageCards(stage);
							return;
						}
						window.setTimeout(function() { window.location.reload(); }, 1300);
					});
				}
			});
		}, 1500);
	},

	render: function(data) {
		const viewInstance = this;
		const status = data[0] || {};
		const preflight = data[1] || {};
		const job = data[2] || {};
		const onSd = status.boot_medium === 'sd' && !!status.transfer_available;
		const canExpand = !!status.expand_available;
		const migrationStage = status.migration_stage || 'not_started';
		const copied = migrationStage === 'copy_completed' || migrationStage === 'boot_confirmed' ||
			migrationStage === 'partition_expanded_reboot_required' || migrationStage === 'expansion_completed';
		const bootConfirmed = migrationStage === 'boot_confirmed' ||
			migrationStage === 'partition_expanded_reboot_required' || migrationStage === 'expansion_completed';
		const expansionCompleted = migrationStage === 'expansion_completed';
		const preflightPassed = onSd && !!preflight.ready;
		const jobContainer = E('div');

		let confirmBootButton = null;
		if (status.boot_confirm_available) {
			confirmBootButton = E('button', {
				'class': 'cbi-button cbi-button-action important'
			}, _('Confirm'));
			confirmBootButton.disabled = !!job.running;
			confirmBootButton.addEventListener('click', ui.createHandlerFn(this, function() {
				confirmBootButton.disabled = true;
				return callMigrationConfirmBoot('CONFIRM_BOOT').then(function(result) {
					if (!result.accepted)
						throw new Error(result.error || _('Unable to confirm eMMC boot'));
					window.location.reload();
				}).catch(function(error) {
					ui.addNotification(null, E('p', {}, error.message), 'error');
					confirmBootButton.disabled = false;
				});
			}));
		}

		let expandButton = null;
		if (canExpand) {
			expandButton = E('button', {
				'class': 'cbi-button cbi-button-action important'
			}, _('Expand'));
			expandButton.disabled = !!job.running;
			expandButton.addEventListener('click', ui.createHandlerFn(this, function() {
				expandButton.disabled = true;
				return callMigrationExpand('EXPAND').then(function(result) {
					if (!result.accepted)
						throw new Error(result.error || _('Unable to start expansion'));
					jobContainer.replaceChildren(progressBlock({
						phase: 'queued',
						percent: 0,
						running: true,
						success: false,
						message: 'Operation queued',
						error: ''
					}));
					viewInstance.pollJob(jobContainer);
				}).catch(function(error) {
					ui.addNotification(null, E('p', {}, error.message), 'error');
					expandButton.disabled = false;
				});
			}));
		}

		const root = E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('SD to eMMC')),
			E('div', { 'class': 'cbi-map-descr' },
				_('Transfer the current OpenWrt installation, settings and NanoPi Control from the SD card to internal eMMC without downloading another firmware image.'))
		]);

		root.appendChild(E('div', {
			'style': 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:15px;margin:18px 0;align-items:stretch'
		}, [
			step(1, _('Preflight check'), _('Verify the board, source system and target eMMC.'), preflightPassed || copied ? 'done' : onSd ? 'active' : 'pending'),
			step(2, _('Copy system'), _('Prepare eMMC and transfer the current OpenWrt state.'), copied ? 'done' : preflightPassed ? 'active' : 'pending'),
			step(3, _('Boot from eMMC'), _('Power off, remove the SD card, boot from eMMC and confirm it here.'), bootConfirmed ? 'done' : copied ? 'active' : 'pending', confirmBootButton),
			step(4, _('Expand partition'), _('Use all available internal storage after boot confirmation.'), expansionCompleted ? 'done' : bootConfirmed ? 'active' : 'pending', expandButton)
		]));

		root.appendChild(jobContainer);
		if (job.phase && job.phase !== 'idle') {
			jobContainer.appendChild(progressBlock(job));
			if (job.running)
				this.pollJob(jobContainer);
		}

		if (onSd) {
			root.appendChild(E('div', { 'class': 'alert-message warning' }, [
				E('strong', {}, _('Warning:') + ' '),
				_('All existing data on %s will be erased. The SD card is not modified and remains your recovery option.').format(preflight.target || status.internal_device || 'eMMC')
			]));

			root.appendChild(E('h3', {}, _('Readiness check')));
			root.appendChild(E('div', { 'class': 'cbi-section' }, [
				checkRow(!!status.supported, _('Device model'), status.model || status.board_name),
				checkRow(status.boot_medium === 'sd', _('Boot source'), '%s · %s'.format(_('SD card'), status.root_partition || '-')),
				checkRow(!!preflight.layout_ready, _('OpenWrt disk layout'), preflight.layout_ready ? _('Supported') : _('Unexpected layout')),
				checkRow(!!preflight.commands_ready, _('Required utilities'), preflight.commands_ready ? _('Installed') : _('Missing packages')),
				checkRow(!!preflight.docker_ready, _('Docker state'),
					preflight.docker_separate_mount ? _('Separate Docker storage is not supported') :
					preflight.docker_installed ? _('Docker and its containers will be migrated; the service will be paused briefly') : _('Docker is not installed')),
				checkRow(!!preflight.size_ready, _('Target capacity'), '%s · %s'.format(preflight.target || '-', formatBytes(preflight.target_size_bytes)))
			]));

			const startButton = E('button', {
				'class': 'btn cbi-button cbi-button-negative important'
			}, _('Erase eMMC and start transfer'));
			const eraseButton = E('button', {
				'class': 'btn cbi-button cbi-button-negative important'
			}, _('Erase eMMC'));
			startButton.disabled = !preflight.ready || !preflight.target || !!job.running;
			eraseButton.disabled = !preflight.target || !!job.running;

			startButton.addEventListener('click', ui.createHandlerFn(this, function() {
				ui.showModal('Подтверждение переноса', [
					E('p', {}, 'Внутренняя память %s будет полностью очищена. После этого текущая система с SD-карты, включая настройки и данные Docker, будет скопирована на eMMC.'.format(preflight.target)),
					E('p', {}, E('strong', {}, 'Все существующие данные на внутренней памяти будут удалены.')),
					E('div', { 'class': 'right' }, [
						E('button', { 'class': 'btn', 'click': ui.hideModal }, 'Отмена'),
						' ',
						E('button', {
							'class': 'btn cbi-button cbi-button-negative important',
							'click': ui.createHandlerFn(this, function() {
								ui.hideModal();
								startButton.disabled = true;
								return callMigrationStart(preflight.target).then(function(result) {
									if (!result.accepted)
										throw new Error(result.error || _('Unable to start transfer'));
									window.location.reload();
								}).catch(function(error) {
									ui.addNotification(null, E('p', {}, error.message), 'error');
									startButton.disabled = !preflight.ready || !preflight.target || !!job.running;
								});
							})
						}, 'Очистить и начать перенос')
					])
				]);
			}));
			eraseButton.addEventListener('click', ui.createHandlerFn(this, function() {
				ui.showModal('Подтверждение очистки', [
					E('p', {}, 'Внутренняя память %s будет полностью очищена. Копирование системы не начнётся.'.format(preflight.target)),
					E('p', {}, E('strong', {}, 'Все существующие данные на внутренней памяти будут удалены.')),
					E('div', { 'class': 'right' }, [
						E('button', { 'class': 'btn', 'click': ui.hideModal }, 'Отмена'),
						' ',
						E('button', {
							'class': 'btn cbi-button cbi-button-negative important',
							'click': ui.createHandlerFn(this, function() {
								ui.hideModal();
								eraseButton.disabled = true;
								return callMigrationErase(preflight.target).then(function(result) {
									if (!result.accepted)
										throw new Error(result.error || _('Unable to erase eMMC'));
									window.location.reload();
								}).catch(function(error) {
									ui.addNotification(null, E('p', {}, error.message), 'error');
									eraseButton.disabled = !preflight.target || !!job.running;
								});
							})
						}, 'Очистить')
					])
				]);
			}));

			root.appendChild(E('h3', {}, 'Копирование системы'));
			root.appendChild(E('div', { 'class': 'cbi-section' }, [
				E('p', {}, 'Выберите действие с внутренней памятью %s. Перед очисткой появится окно подтверждения.'.format(preflight.target || '-')),
				E('div', { 'style': 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [ startButton, eraseButton ]),
				E('p', { 'style': 'color:#666;margin-top:12px' },
					_('After successful copying, shut the NanoPi down, remove the SD card and boot it again. Do not erase the SD card until eMMC boot is verified.'))
			]));
		}
		else if (!status.boot_confirm_available && !canExpand && !expansionCompleted) {
			root.appendChild(E('div', { 'class': 'alert-message warning' },
				_('The transfer assistant is not available in the current boot state.')));
		}

		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
