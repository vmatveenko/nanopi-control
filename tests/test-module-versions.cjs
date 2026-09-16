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
}
let calls = [], fail = false;
const sandbox = {
  E: (...args) => new Element(...args), view: { extend: x => x }, _: x => x,
  rpc: { declare: spec => (...args) => {
    calls.push([spec.method, ...args]);
    return fail ? Promise.reject(new Error('offline')) : Promise.resolve({ versions: ['latest', '3.7.0', '3.6.0'] });
  } },
  ui: { createHandlerFn: (self, fn) => fn.bind(self) },
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
  let node = view.renderModuleVersion(module, false), select = node.children[0];
  assert.equal(select.value, 'latest'); await tick();
  assert.equal(select.children.length, 3);
  select.value = '3.6.0'; select.change();
  let chosen;
  view.startModuleAction = (...args) => { chosen = args; };
  const table = view.renderModules({ modules: [module] }, new Element('div'));
  assert.equal(table.columns.length, 5);
  await table.rows[0][4].listeners.click();
  assert.equal(chosen[4], '3.6.0');
  assert.equal(table.rows[0][1].children[0].value, '3.6.0');
  assert.equal(calls.length, 1, 'reuse the list across status refreshes');
  assert.equal(view.renderModuleVersion(module, true).children[0].disabled, true);
  fail = true;
  node = view.renderModuleVersion({ id: 'caddy', name: 'Caddy', can_install: true }, false);
  await tick();
  assert.equal(node.children[0].value, 'latest');
  assert.match(node.children[1].textContent, /Не удалось/);
  assert.equal(node.children[0].disabled, false, 'offline catalog must not block latest');
  console.log('PASS: installed read-only version, selection, install argument, refresh, offline fallback');
})().catch(error => { console.error(error); process.exitCode = 1; });
