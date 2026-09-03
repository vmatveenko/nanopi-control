'use strict';
'require view';
'require rpc';
'require ui';

const callCaddyStatus = rpc.declare({
	object: 'nanopi-control',
	method: 'caddy_status',
	expect: {}
});

const callCaddyAction = rpc.declare({
	object: 'nanopi-control',
	method: 'caddy_action',
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
		return callCaddyStatus();
	},

	performAction: function(action) {
		ui.showModal('Caddy', [
			E('p', { 'class': 'spinning' }, action === 'stop'
				? 'Остановка контейнера…'
				: action === 'start' ? 'Запуск контейнера…' : 'Перезапуск контейнера…')
		]);
		return callCaddyAction(action).then(function(result) {
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
		const validationColor = state.config_valid ? '#16803a' : '#d97706';
		const rows = [
			[ 'Состояние', E('span', { 'style': 'color:' + stateColor }, stateLabel(state.state)) ],
			[ 'Проверка работоспособности', E('span', { 'style': 'color:' + validationColor },
				state.config_valid ? 'Конфигурация исправна' : running ? 'Конфигурация не прошла проверку' : 'Недоступна, пока контейнер остановлен') ],
			[ 'Версия Caddy', state.version || (running ? 'Не определена' : 'Недоступна, пока контейнер остановлен') ],
			[ 'Образ', state.image || '—' ],
			[ 'Идентификатор контейнера', state.container_id || '—' ],
			[ 'Создан', formatDate(state.created) ],
			[ 'Запущен', formatDate(state.started_at) ],
			[ 'Политика перезапуска', state.restart_policy || '—' ],
			[ 'Сетевой режим', state.network_mode || '—' ],
			[ 'Caddyfile', state.caddyfile || '/opt/caddy/Caddyfile' ],
			[ 'Каталог данных', state.data_path || '/opt/caddy/data' ],
			[ 'Каталог конфигурации', state.config_path || '/opt/caddy/config' ],
			[ 'Административный API', state.admin_address || '127.0.0.1:2019' ]
		];

		return E('div', {}, [
			E('h2', { 'class': 'section-title' }, 'Caddy - Обзор'),
			E('p', {}, 'Здесь отображается текущее состояние контейнера Caddy.'),
			E('div', { 'style': 'display:flex;gap:6px;margin:12px 0 16px' }, [ firstButton, stopButton ]),
			informationTable(rows),
			installed ? E('div', {
				'class': 'alert-message warning',
				'style': 'margin-top:16px'
			}, 'Caddy установлен с базовой конфигурацией. HTTPS-сайты и проксирование пока не настроены.') : E('div', {
				'class': 'alert-message warning',
				'style': 'margin-top:16px'
			}, state.error || 'Контейнер Caddy не найден. Вернитесь на страницу «Обзор» и установите модуль.')
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
