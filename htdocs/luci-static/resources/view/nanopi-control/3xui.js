'use strict';
'require view';
'require rpc';
'require ui';

const callXuiStatus = rpc.declare({
	object: 'nanopi-control',
	method: 'xui_status',
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

function informationTable(rows) {
	return E('table', { 'class': 'table' }, [
		E('tr', { 'class': 'tr table-titles' }, [
			E('th', { 'class': 'th', 'style': 'width:40%' }, 'Информация'),
			E('th', { 'class': 'th' })
		])
	].concat(rows.map(function(row) {
		return E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, row[0]),
			E('td', { 'class': 'td' }, row[1])
		]);
	})));
}

return view.extend({
	load: function() {
		return callXuiStatus();
	},

	performAction: function(action) {
		ui.showModal('3x-ui', [
			E('p', { 'class': 'spinning' }, action === 'stop'
				? 'Остановка контейнера…'
				: action === 'start' ? 'Запуск контейнера…' : 'Перезапуск контейнера…')
		]);
		return callXuiAction(action).then(function(result) {
			if (!result.accepted)
				throw new Error(result.error || 'Не удалось выполнить действие');
			window.setTimeout(function() { window.location.reload(); }, 500);
		}).catch(function(error) {
			ui.hideModal();
			ui.addNotification(null, E('p', {}, error.message), 'error');
		});
	},

	render: function(state) {
		const view = this;
		const installed = !!state.installed;
		const running = !!state.running;
		const url = panelUrl(state.panel_port);
		const firstButton = E('button', {
			'class': 'btn cbi-button-action neutral'
		}, running ? 'Перезапустить' : 'Запустить');
		const stopButton = E('button', {
			'class': 'btn cbi-button-action negative'
		}, 'Остановить');
		firstButton.disabled = !installed;
		stopButton.disabled = !running;
		firstButton.addEventListener('click', ui.createHandlerFn(view, function() {
			return view.performAction(running ? 'restart' : 'start');
		}));
		stopButton.addEventListener('click', ui.createHandlerFn(view, function() {
			return view.performAction('stop');
		}));
		const stateColor = running ? '#16803a' : installed ? '#d97706' : '#b42318';
		const rows = [
			[ 'Состояние', E('span', { 'style': 'color:' + stateColor }, stateLabel(state.state)) ],
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

		return E('div', {}, [
			E('h2', { 'class': 'section-title' }, '3x-ui — Обзор'),
			E('p', {}, 'Здесь отображается текущее состояние контейнера 3x-ui.'),
			E('div', { 'style': 'display:flex;gap:6px;margin:12px 0 16px' }, [ firstButton, stopButton ]),
			informationTable(rows),
			installed ? E('div', {
				'class': 'alert-message warning',
				'style': 'margin-top:16px'
			}, [
				E('strong', {}, 'Внимание: '),
				'3x-ui установлен с реквизитами admin / admin. Не открывайте панель в WAN и смените пароль перед настройкой VPN.'
			]) : E('div', {
				'class': 'alert-message warning',
				'style': 'margin-top:16px'
			}, state.error || 'Контейнер 3x-ui не найден. Вернитесь на страницу «Обзор» и установите модуль.')
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
