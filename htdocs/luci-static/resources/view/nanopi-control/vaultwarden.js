'use strict';
'require view';
'require rpc';
'require ui';

const callVaultwardenStatus = rpc.declare({
	object: 'nanopi-control',
	method: 'vaultwarden_status',
	expect: {}
});

const callVaultwardenAction = rpc.declare({
	object: 'nanopi-control',
	method: 'vaultwarden_action',
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

function healthLabel(health) {
	const labels = {
		healthy: 'Исправен',
		unhealthy: 'Ошибка проверки',
		starting: 'Запускается',
		none: 'Не настроена'
	};
	return labels[health] || health || 'Неизвестно';
}

function formatDate(value) {
	if (!value || /^0001-/.test(value))
		return '—';
	const date = new Date(value);
	return isNaN(date.getTime()) ? value : date.toLocaleString();
}

function serviceUrl(port) {
	let host = window.location.hostname;
	if (host.indexOf(':') >= 0 && host.charAt(0) !== '[')
		host = '[' + host + ']';
	return 'http://' + host + ':' + (port || 8000) + '/';
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
		return callVaultwardenStatus();
	},

	performAction: function(action) {
		ui.showModal('Vaultwarden', [
			E('p', { 'class': 'spinning' }, action === 'stop'
				? 'Остановка контейнера…'
				: action === 'start' ? 'Запуск контейнера…' : 'Перезапуск контейнера…')
		]);
		return callVaultwardenAction(action).then(function(result) {
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
		const url = serviceUrl(state.port);
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
			[ 'Проверка работоспособности', healthLabel(state.health) ],
			[ 'Версия Vaultwarden', state.version || (running ? 'Не определена' : 'Недоступна, пока контейнер остановлен') ],
			[ 'Образ', state.image || '—' ],
			[ 'Идентификатор контейнера', state.container_id || '—' ],
			[ 'Создан', formatDate(state.created) ],
			[ 'Запущен', formatDate(state.started_at) ],
			[ 'Политика перезапуска', state.restart_policy || '—' ],
			[ 'Сетевой режим', state.network_mode || '—' ],
			[ 'Регистрация новых пользователей', state.signups_allowed === 'true' ? 'Разрешена' : 'Запрещена' ],
			[ 'Каталог данных', state.data_path || '/opt/vaultwarden' ],
			[ 'Веб-интерфейс', installed ? E('a', { 'href': url, 'target': '_blank', 'rel': 'noreferrer' }, url) : '—' ]
		];

		return E('div', {}, [
			E('h2', { 'class': 'section-title' }, 'Vaultwarden - Обзор'),
			E('p', {}, 'Здесь отображается текущее состояние контейнера Vaultwarden.'),
			E('div', { 'style': 'display:flex;gap:6px;margin:12px 0 16px' }, [ firstButton, stopButton ]),
			informationTable(rows),
			installed ? E('div', {
				'class': 'alert-message warning',
				'style': 'margin-top:16px'
			}, [
				E('strong', {}, 'Важно: '),
				'регистрация пользователей включена для первичной настройки. Для полноценной работы веб-хранилища и клиентов настройте HTTPS, затем запретите открытую регистрацию.'
			]) : E('div', {
				'class': 'alert-message warning',
				'style': 'margin-top:16px'
			}, state.error || 'Контейнер Vaultwarden не найден. Вернитесь на страницу «Обзор» и установите модуль.')
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
