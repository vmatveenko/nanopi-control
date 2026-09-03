'use strict';
'require view';
'require rpc';
'require ui';

const callXuiStatus = rpc.declare({
	object: 'nanopi-control',
	method: 'xui_status',
	expect: {}
});

const callXuiSettings = rpc.declare({
	object: 'nanopi-control',
	method: 'xui_settings',
	expect: {}
});

const callXuiSettingsSave = rpc.declare({
	object: 'nanopi-control',
	method: 'xui_settings_save',
	params: [ 'token', 'exclude4', 'exclude6', 'block_ipv6' ],
	expect: {}
});

const callXuiTokenIssue = rpc.declare({
	object: 'nanopi-control',
	method: 'xui_token_issue',
	expect: {}
});

const callXuiRoutingSet = rpc.declare({
	object: 'nanopi-control',
	method: 'xui_routing_set',
	params: [ 'enabled' ],
	expect: {}
});

const callXuiAction = rpc.declare({
	object: 'nanopi-control',
	method: 'xui_action',
	params: [ 'action' ],
	expect: {}
});

function stateLabel(state) {
	const labels = {
		running: 'Запущен',
		exited: 'Остановлен',
		created: 'Создан',
		restarting: 'Перезапускается',
		paused: 'Приостановлен',
		dead: 'Ошибка',
		absent: 'Не установлен'
	};
	return labels[state] || state || 'Неизвестно';
}

function formatDate(value) {
	if (!value || /^0001-/.test(value))
		return '—';
	const date = new Date(value);
	return isNaN(date.getTime()) ? value : date.toLocaleString();
}

function panelUrl(port) {
	let host = window.location.hostname;
	if (host.indexOf(':') >= 0 && host.charAt(0) !== '[')
		host = '[' + host + ']';
	return 'http://' + host + ':' + (port || 2053) + '/';
}

function twoColumnTable(title, rows) {
	return E('table', { 'class': 'table' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th', 'style': 'width:34%' }, title),
			E('th', { 'class': 'th' }, 'Значение')
		])
	].concat(rows.map(function(row) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td', 'style': 'vertical-align:top' }, row[0]),
			E('td', { 'class': 'td' }, row[1])
		]);
	})));
}

function automaticNetworks(values) {
	return E('div', {
		'style': 'font-size:90%;color:#667085;margin-bottom:6px;line-height:1.45'
	}, [
		E('strong', {}, 'Автоматически: '),
		(values && values.length) ? values.join(', ') : 'не определены'
	]);
}

function operationError(result, fallback) {
	if (!result || !result.accepted)
		throw new Error((result && result.error) || fallback);
	return result;
}

return view.extend({
	load: function() {
		return Promise.all([ callXuiStatus(), callXuiSettings() ]);
	},

	notifyResult: function(result) {
		if (result.warning)
			ui.addNotification(null, E('p', {}, result.warning), 'warning');
		else if (result.message)
			ui.addNotification(null, E('p', {}, result.message), 'info');
	},

	runContainerAction: function(action) {
		const view = this;
		ui.showModal('3x-ui', [
			E('p', { 'class': 'spinning' }, action === 'stop'
				? 'Остановка контейнера…'
				: action === 'start' ? 'Запуск контейнера…' : 'Перезапуск контейнера…')
		]);
		return callXuiAction(action).then(function(result) {
			operationError(result, 'Не удалось выполнить действие');
			ui.hideModal();
			view.notifyResult(result);
			window.setTimeout(function() { window.location.reload(); }, 700);
		}).catch(function(error) {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, error.message), 'error');
		});
	},

	performAction: function(action) {
		const view = this;
		if (action !== 'stop' || !view.routingActive)
			return view.runContainerAction(action);

		ui.showModal('Остановить 3x-ui?', [
			E('p', {}, 'Маршрутизация LAN сейчас включена. После остановки контейнера сработает fail-closed: доступ LAN в интернет прекратится, пока 3x-ui не будет запущен снова или маршрутизация не будет выключена.'),
			E('div', { 'class': 'right' }, [
				E('button', {
					'class': 'btn',
					'click': ui.hideModal
				}, 'Отмена'),
				' ',
				E('button', {
					'class': 'btn cbi-button-negative',
					'click': ui.createHandlerFn(view, function() {
						ui.hideModal();
						return view.runContainerAction('stop');
					})
				}, 'Остановить')
			])
		]);
	},

	settingsPayload: function() {
		return {
			token: this.tokenInput.value || '',
			exclude4: this.exclude4Input.value || '',
			exclude6: this.exclude6Input.value || '',
			block_ipv6: !!this.blockIpv6Input.checked
		};
	},

	saveSettings: function(showModal, section) {
		const view = this;
		const values = view.settingsPayload();
		if (section === 'routing')
			values.token = '';
		if (showModal !== false)
			ui.showModal('Настройки 3x-ui', [ E('p', { 'class': 'spinning' }, view.routingActive ? 'Сохранение и применение…' : 'Сохранение…') ]);
		const current = section === 'token' ? callXuiSettings() : Promise.resolve(null);
		return current.then(function(saved) {
			if (saved) {
				values.exclude4 = saved.exclude4 || '';
				values.exclude6 = saved.exclude6 || '';
				values.block_ipv6 = !!saved.block_ipv6;
			}
			return callXuiSettingsSave(values.token, values.exclude4, values.exclude6, values.block_ipv6);
		}).then(function(result) {
			operationError(result, 'Не удалось сохранить настройки');
			if (values.token) {
				view.tokenInput.value = '';
				view.tokenStatus.textContent = 'Токен настроен и проверен';
				view.tokenInput.placeholder = 'Сохранённый токен не отображается';
			}
			if (showModal !== false) {
				ui.hideModal();
				view.notifyResult(result);
			}
			return result;
		}).catch(function(error) {
			if (showModal !== false) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, error.message), 'error');
			}
			throw error;
		});
	},

	issueToken: function() {
		const view = this;
		ui.showModal('API-токен 3x-ui', [ E('p', { 'class': 'spinning' }, 'Выпуск токена openwrt-api-token…') ]);
		return callXuiTokenIssue().then(function(result) {
			operationError(result, 'Не удалось выпустить API-токен');
			view.tokenInput.value = '';
			view.tokenInput.placeholder = 'Сохранённый токен не отображается';
			view.tokenStatus.textContent = 'Токен openwrt-api-token настроен и проверен';
			ui.hideModal();
			view.notifyResult(result);
		}).catch(function(error) {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, error.message), 'error');
		});
	},

	setRouting: function(enabled) {
		const view = this;
		view.routingButton.disabled = true;
		ui.showModal('Маршрутизация через 3x-ui', [
			E('p', { 'class': 'spinning' }, enabled
				? 'Проверка настроек, подготовка TUN и применение правил…'
				: 'Отключение маркировки и policy routing…')
		]);
		const save = enabled ? view.saveSettings(false, 'routing') : Promise.resolve();
		return save.then(function() {
			return callXuiRoutingSet(enabled);
		}).then(function(result) {
			operationError(result, enabled ? 'Не удалось включить маршрутизацию' : 'Не удалось выключить маршрутизацию');
			view.routingActive = enabled;
			view.routingButton.textContent = enabled ? 'Выключить маршрутизацию' : 'Включить маршрутизацию';
			view.routingButton.className = enabled ? 'btn cbi-button-negative' : 'btn cbi-button-action';
			view.routingState.textContent = enabled ? 'Включена' : 'Выключена';
			view.routingState.style.color = enabled ? '#16803a' : '#667085';
			view.routingSaveButton.textContent = enabled ? 'Сохранить и применить' : 'Сохранить';
			ui.hideModal();
			view.notifyResult(result);
		}).catch(function(error) {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, error.message), 'error');
		}).finally(function() {
			view.routingButton.disabled = !view.containerRunning && !view.routingActive;
		});
	},

	showTab: function(name) {
		const view = this;
		Object.keys(view.tabPanels).forEach(function(key) {
			view.tabPanels[key].style.display = key === name ? '' : 'none';
			view.tabItems[key].className = key === name ? 'cbi-tab' : 'cbi-tab-disabled';
		});
	},

	renderTabs: function(settings, informationPanel, running) {
		const view = this;
		view.containerRunning = running;
		view.tokenInput = E('input', {
			'class': 'cbi-input-text',
			'type': 'password',
			'autocomplete': 'new-password',
			'placeholder': settings.token_configured ? 'Сохранённый токен не отображается' : 'Введите API-токен',
			'style': 'min-width:260px;flex:1'
		});
		const issueButton = E('button', {
			'class': 'btn cbi-button-action',
			'type': 'button',
			'title': 'Выпустить токен openwrt-api-token',
			'aria-label': 'Выпустить API-токен',
			'style': 'min-width:38px;padding:4px 9px'
		}, '🔑');
		issueButton.disabled = !running;
		issueButton.addEventListener('click', ui.createHandlerFn(view, function() { return view.issueToken(); }));
		view.tokenStatus = E('div', { 'style': 'font-size:90%;color:#667085;margin-top:5px' },
			settings.token_configured ? 'Токен настроен; сохранённое значение скрыто' : 'Токен ещё не настроен');
		view.exclude4Input = E('textarea', {
			'class': 'cbi-input-textarea',
			'rows': 5,
			'placeholder': 'По одной IPv4-сети в формате CIDR на строку',
			'style': 'width:100%;box-sizing:border-box'
		}, settings.exclude4 || '');
		view.exclude6Input = E('textarea', {
			'class': 'cbi-input-textarea',
			'rows': 5,
			'placeholder': 'По одной IPv6-сети в формате CIDR на строку',
			'style': 'width:100%;box-sizing:border-box'
		}, settings.exclude6 || '');
		view.blockIpv6Input = E('input', {
			'class': 'cbi-input-checkbox',
			'type': 'checkbox'
		});
		view.blockIpv6Input.checked = !!settings.block_ipv6;
		const tokenSaveButton = E('button', {
			'class': 'btn cbi-button-positive',
			'type': 'button'
		}, 'Сохранить');
		tokenSaveButton.addEventListener('click', ui.createHandlerFn(view, function() {
			return view.saveSettings(true, 'token').catch(function() {});
		}));
		view.routingSaveButton = E('button', {
			'class': 'btn cbi-button-positive',
			'type': 'button'
		}, settings.routing_active ? 'Сохранить и применить' : 'Сохранить');
		view.routingSaveButton.addEventListener('click', ui.createHandlerFn(view, function() {
			return view.saveSettings(true, 'routing').catch(function() {});
		}));

		const tokenRows = [
			[ 'API-токен', E('div', {}, [
				E('div', { 'style': 'display:flex;gap:6px;align-items:center;max-width:620px' }, [ view.tokenInput, issueButton ]),
				view.tokenStatus
			]) ]
		];
		const routingRows = [
			[ 'Исключаемые IPv4-сети', E('div', {}, [
				automaticNetworks(settings.automatic_exclude4),
				view.exclude4Input
			]) ],
			[ 'Исключаемые IPv6-сети', E('div', {}, [
				automaticNetworks(settings.automatic_exclude6),
				view.exclude6Input,
				E('div', { 'style': 'font-size:90%;color:#667085;margin-top:5px' }, 'При блокировке IPv6 указанные здесь сети остаются разрешёнными напрямую.')
			]) ],
			[ 'Блокировать IPv6', E('label', { 'style': 'display:flex;gap:8px;align-items:center' }, [
				view.blockIpv6Input,
				E('span', {}, 'Запрещать внешний IPv6-трафик LAN, кроме исключений')
			]) ]
		];
		const settingsPanel = E('div', {}, [
			twoColumnTable('Параметр', tokenRows),
			E('div', { 'style': 'margin-top:12px' }, [ tokenSaveButton ])
		]);
		const routingPanel = E('div', {}, [
			E('p', {}, 'Пользовательские исключения сохраняются в OpenWrt. Автоматические сети вычисляются при каждом применении.'),
			twoColumnTable('Параметр', routingRows),
			E('div', { 'style': 'margin-top:12px' }, [ view.routingSaveButton ])
		]);
		view.tabPanels = {
			information: informationPanel,
			settings: settingsPanel,
			routing: routingPanel
		};
		view.tabItems = {};
		const tabDefinitions = [
			[ 'information', 'Информация' ],
			[ 'settings', 'Настройка' ],
			[ 'routing', 'Маршрутизация' ]
		];
		const tabMenu = E('ul', { 'class': 'cbi-tabmenu' }, tabDefinitions.map(function(tab) {
			const item = E('li', { 'class': 'cbi-tab-disabled' }, [
				E('a', { 'href': '#' }, tab[1])
			]);
			item.firstElementChild.addEventListener('click', function(event) {
				event.preventDefault();
				view.showTab(tab[0]);
			});
			view.tabItems[tab[0]] = item;
			return item;
		}));
		const tabs = E('div', { 'style': 'margin-top:18px' }, [
			tabMenu,
			E('div', { 'style': 'margin-top:12px' }, [ informationPanel, settingsPanel, routingPanel ])
		]);
		view.showTab('information');
		return tabs;
	},

	render: function(data) {
		const view = this;
		const state = data[0] || {};
		const settings = data[1] || {};
		const installed = !!state.installed;
		const running = !!state.running;
		const url = panelUrl(state.panel_port);
		const firstButton = E('button', {
			'class': 'btn cbi-button-action neutral'
		}, running ? 'Перезапустить' : 'Запустить');
		const stopButton = E('button', {
			'class': 'btn cbi-button-action negative'
		}, 'Остановить');
		view.routingActive = !!settings.routing_active;
		view.routingButton = E('button', {
			'class': view.routingActive ? 'btn cbi-button-negative' : 'btn cbi-button-action'
		}, view.routingActive ? 'Выключить маршрутизацию' : 'Включить маршрутизацию');
		firstButton.disabled = !installed;
		stopButton.disabled = !running;
		view.routingButton.disabled = !running && !view.routingActive;
		firstButton.addEventListener('click', ui.createHandlerFn(view, function() {
			return view.performAction(running ? 'restart' : 'start');
		}));
		stopButton.addEventListener('click', ui.createHandlerFn(view, function() {
			return view.performAction('stop');
		}));
		view.routingButton.addEventListener('click', ui.createHandlerFn(view, function() {
			return view.setRouting(!view.routingActive);
		}));
		const stateColor = running ? '#16803a' : installed ? '#d97706' : '#b42318';
		view.routingState = E('span', {
			'style': 'color:' + (view.routingActive ? '#16803a' : '#667085')
		}, view.routingActive ? 'Включена' : 'Выключена');
		const rows = [
			[ 'Состояние', E('span', { 'style': 'color:' + stateColor }, stateLabel(state.state)) ],
			[ 'Маршрутизация', view.routingState ],
			[ 'Версия 3x-ui', state.version || (running ? 'Не определена' : 'Недоступна, пока контейнер остановлен') ],
			[ 'Образ', state.image || '—' ],
			[ 'Идентификатор контейнера', state.container_id || '—' ],
			[ 'Создан', formatDate(state.created) ],
			[ 'Запущен', formatDate(state.started_at) ],
			[ 'Политика перезапуска', state.restart_policy || '—' ],
			[ 'Сетевой режим', state.network_mode || '—' ],
			[ 'Fail2ban', state.fail2ban === 'true' ? 'Включён' : 'Отключён' ],
			[ 'Каталог данных', state.data_path || '/opt/3x-ui' ],
			[ 'Панель', installed ? E('a', { 'href': url, 'target': '_blank', 'rel': 'noreferrer' }, url) : '—' ]
		];
		const informationContent = [ twoColumnTable('Информация', rows) ];
		if (state.routing_degraded) {
			informationContent.push(E('div', { 'class': 'alert-message warning', 'style': 'margin-top:16px' },
				'Маршрутизация находится в fail-closed: xray0 или контейнер недоступен. Запустите 3x-ui либо выключите маршрутизацию.'));
		}
		const informationPanel = E('div', {}, informationContent);
		const content = [
			E('h2', { 'class': 'section-title' }, '3x-ui — Обзор'),
			E('p', {}, 'Здесь отображается текущее состояние контейнера 3x-ui.'),
			E('div', { 'style': 'display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 16px' }, [ firstButton, stopButton, view.routingButton ])
		];
		if (installed) {
			content.push(view.renderTabs(settings, informationPanel, running));
		} else {
			content.push(informationPanel);
			content.push(E('div', { 'class': 'alert-message warning', 'style': 'margin-top:16px' },
				state.error || 'Контейнер 3x-ui не найден. Вернитесь на страницу «Обзор» и установите модуль.'));
		}
		return E('div', {}, content);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
