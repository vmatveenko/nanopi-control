const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tag = tag; Object.assign(this, attrs); this.children = [].concat(children);
    this.listeners = {}; this.value = attrs.value || '';
  }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute(name, value) { this[name] = value; }
  querySelector() { return { querySelector() { return {}; }, insertBefore() {} }; }
}
let calls = [], fail = false, modal;
const sandbox = {
  E: (...args) => new Element(...args), view: { extend: x => x }, _: x => x,
  rpc: { declare: spec => (...args) => {
    calls.push([spec.method, ...args]);
    return fail ? Promise.reject(new Error('offline')) : Promise.resolve({ versions: ['latest', '3.7.0', '3.6.0'] });
  } },
  ui: { showModal: (title, children) => { modal = { title, children }; }, hideModal: () => { modal = null; }, createHandlerFn: (self, fn) => fn.bind(self) },
  L: { ui: { Table: class { constructor(columns) { this.columns = columns; } update(rows) { this.rows = rows; } render() { return this; } } } }
};
const source = fs.readFileSync(__dirname + '/../htdocs/luci-static/resources/view/nanopi-control/dashboard.js', 'utf8');
const view = vm.runInNewContext('(function(){' + source + '\n})()', sandbox);
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  let module = { id: '3x-ui', name: '3x-ui', installed: true, version: '3.7.0', image: 'repo:latest' };
  const installed = view.renderModuleVersion(module, false);
  assert.equal(installed.tag, 'span'); assert.equal(installed.children[0], '3.7.0'); assert.equal(calls.length, 0);
  assert.equal(view.renderModuleVersion({ id: 'docker' }, false), '—');
  module = { ...module, installed: false, can_install: true };
  let link = view.renderModuleVersion(module, false);
  assert.equal(link.tag, 'a'); assert.equal(link.children[0], 'latest'); await tick();
  assert.equal(calls.length, 0, 'render must not fetch versions');
  await link.listeners.click({ preventDefault() {} });
  assert.equal(calls.length, 1);
  assert.equal(modal.children[1].children.length, 3);
  let radio = modal.children[1].children[2].children[0];
  radio.checked = true; radio.listeners.change();
  modal.children[2].children[0].click();
  assert.equal(view.moduleVersionChoices[module.id], undefined, 'cancel preserves selection');
  await link.listeners.click({ preventDefault() {} });
  radio = modal.children[1].children[2].children[0]; radio.checked = true; radio.listeners.change();
  modal.children[2].children[2].click();
  assert.equal(view.moduleVersionChoices[module.id], '3.6.0');
  assert.equal(link.textContent, '3.6.0'); assert.equal(calls.length, 1, 'reuse catalog');
  let chosen;
  view.startModuleAction = (...args) => { chosen = args; };
  const table = view.renderModules({ modules: [module] }, new Element('div'));
  assert.deepEqual(Array.from(table.columns), ['Модуль', 'Состояние', 'Зависимости', 'Версия', 'Действие']);
  await table.rows[0][4].listeners.click();
  assert.equal(chosen[4], '3.6.0');
  assert.equal(table.rows[0][3].children[0], '3.6.0');
  assert.equal(view.renderModuleVersion(module, true).tag, 'span');
  assert.equal(view.renderModuleVersion({ ...module, can_install: false }, false).tag, 'a');
  fail = true;
  link = view.renderModuleVersion({ id: 'caddy', name: 'Caddy', can_install: true }, false);
  await link.listeners.click({ preventDefault() {} });
  assert.equal(calls.length, 2);
  assert.match(modal.children[0].children[0], /Не удалось/);
  fail = false;
  await modal.children[0].children[1].click({ preventDefault() {} });
  assert.equal(calls.length, 3, 'retry actually fetches');
  assert.equal(modal.children[1].children.length, 3);
  console.log('PASS: modal lazy loading, radio selection, apply/cancel, retry, column order, install argument');
})().catch(error => { console.error(error); process.exitCode = 1; });
