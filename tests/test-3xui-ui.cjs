const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');

// Exercise the actual LuCI view with a small DOM/RPC fixture; no device writes.
class Element {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag;
    this.style = {};
    this.listeners = {};
    this.children = (Array.isArray(children) ? children : [children]).filter(x => x != null);
    this.value = tag === 'textarea' ? this.children.join('') : '';
    this.checked = false;
    this.disabled = false;
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'style') {
        for (const rule of value.split(';')) {
          const [name, setting] = rule.split(':');
          if (name) this.style[name.trim()] = setting.trim();
        }
      } else if (key === 'click') this.addEventListener('click', value);
      else this[key] = value;
    }
  }
  get firstElementChild() { return this.children.find(x => x instanceof Element); }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  dispatch(name) { return Promise.all((this.listeners[name] || []).map(fn => fn({ preventDefault() {} }))); }
  focus() {}
  select() {}
}
const calls = [];
let failSave = false, failIssue = false;
let modal = null;
const savedSettings = { exclude4: '192.0.2.0/24', exclude6: '', block_ipv6: false, token_configured: true, routing_active: true, panel_port: '4053', panel_path: '/', panel_wan: false, panel_settings_known: true };
const handlers = {
  xui_settings: () => ({ ...savedSettings }),
  xui_settings_save: (...args) => {
    calls.push(args);
    return failSave ? { accepted: false, error: 'test save error' } : { accepted: true };
  },
  xui_panel_save: (token, port, path, wan) => {
    calls.push([token, port, path, wan]);
    return failSave ? { accepted: false, error: 'save error' } : { accepted: true, panel_port: port, panel_path: path.startsWith('/') ? path : '/' + path + '/', panel_wan: wan };
  },
  xui_token_issue: () => failIssue ? { accepted: false, error: 'test issue error' } : { accepted: true },
  xui_password_reset: () => ({ accepted: true, username: 'admin', password: 'A'.repeat(20) }),
  xui_routing_set: () => ({ accepted: true })
};
const sandbox = {
  E: (tag, attrs, children) => new Element(tag, attrs, children),
  view: { extend: value => value },
  rpc: { declare: spec => (...args) => Promise.resolve().then(() => handlers[spec.method](...args)) },
  ui: {
    showModal: (title, children) => { modal = { title, children }; },
    hideModal: () => { modal = null; }, addNotification() {},
    createHandlerFn: (view, handler) => handler.bind(view)
  },
  window: { location: { hostname: 'localhost', reload() {} }, setTimeout() {}, isSecureContext: false, getComputedStyle: () => ({borderTopColor: 'rgb(204, 204, 204)', color: 'rgb(51, 51, 51)'}) },
  navigator: {}, document: { execCommand: () => true }, console
};
const source = fs.readFileSync(__dirname + '/../htdocs/luci-static/resources/view/nanopi-control/3xui.js', 'utf8');
const view = vm.runInNewContext('(function(){' + source + '\n})()', sandbox);
view.routingActive = true;
view.panelLink = new Element('a');
view.renderTabs(savedSettings, new Element('div'), true);
const edit = async (input, value) => { input.value = value; await input.dispatch('input'); };

(async () => {
  assert.equal(view.tokenSaveButton.disabled, true);
  assert.notEqual(view.tokenSaveButton.style.display, 'none');
  assert.equal(view.routingSaveButton.disabled, true);
  for (const [input, value] of [[view.portInput,'4054'], [view.pathInput,'/private/']]) {
    const old = input.value;
    await edit(input, value); assert.equal(view.tokenSaveButton.disabled, false);
    await edit(input, old); assert.equal(view.tokenSaveButton.disabled, true);
  }
  view.wanInput.checked = true; await view.wanInput.dispatch('change');
  assert.equal(view.tokenSaveButton.disabled, false);
  view.wanInput.checked = false; await view.wanInput.dispatch('change');
  assert.equal(view.tokenSaveButton.disabled, true);
  await edit(view.tokenInput, 'manual-test-token-123'); assert.equal(view.tokenSaveButton.disabled, false);
  await edit(view.tokenInput, ''); assert.equal(view.tokenSaveButton.disabled, true);
  await view.issueToken(); assert.equal(view.tokenSaveButton.disabled, true);
  await view.resetPassword(); assert.equal(view.tokenSaveButton.disabled, true);
  await edit(view.portInput, '4054');
  await view.issueToken(); assert.equal(view.tokenSaveButton.disabled, false);
  assert.equal(view.portInput.value, '4054');
  await edit(view.exclude4Input, '198.51.100.0/24');
  await edit(view.pathInput, 'private');
  view.wanInput.checked = true;
  await view.saveSettings(true, 'token');
  assert.equal(view.tokenSaveButton.disabled, true);
  assert.equal(view.pathInput.value, '/private/');
  assert.equal(view.panelLink.href, 'http://localhost:4054/private/');
  assert.equal(view.routingSaveButton.disabled, false);
  assert.equal(view.exclude4Input.value, '198.51.100.0/24');
  await view.saveSettings(true, 'routing');
  assert.equal(view.routingSaveButton.disabled, true);
  assert.equal(view.tokenSaveButton.disabled, true);
  await edit(view.portInput, '4055');
  failSave = true; await assert.rejects(view.saveSettings(true, 'token'));
  assert.equal(view.tokenSaveButton.disabled, false);
  assert.equal(view.panelLink.href, 'http://localhost:4054/private/');
  await edit(view.portInput, '4054'); assert.equal(view.tokenSaveButton.disabled, true);
  view.showTab('settings');
  assert.equal(view.issueButton.style.borderColor, 'rgb(204, 204, 204)');
  assert.equal(view.issueButton.style.color, view.issueButton.style.borderColor);
  assert.equal(view.resetPasswordButton.style.borderColor, view.issueButton.style.borderColor);
  assert.equal(view.tokenInput.style.height, view.issueButton.style.height);
  console.log('PASS: visible disabled Save, dirty/revert behavior for all settings, automatic token actions, independent routing drafts, link update, errors, neutral colors');
})().catch(error => { console.error(error); process.exitCode = 1; });
