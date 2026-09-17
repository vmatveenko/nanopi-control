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
  replaceChildren(...children) { this.children = children; }
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
	L: { url: (...parts) => '/cgi-bin/luci/' + parts.join('/') },
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
  const snapshot = { status: { running: true }, settings: savedSettings, certificate: { domain: 'example.test' } };
  let overviewCalls = 0;
  handlers.xui_overview = () => { overviewCalls++; return snapshot; };
  const initial = await view.load();
  assert.equal(overviewCalls, 1);
  assert.equal(initial[0], snapshot.status);
  assert.equal(initial[1], snapshot.settings);
  assert.equal(initial[2], snapshot.certificate);
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
  const flat = element => element instanceof Element ? element.children.flatMap(flat) : [String(element)];
  const buttons = element => element instanceof Element
    ? [ ...(element.tagName === 'button' ? [element] : []), ...element.children.flatMap(buttons) ] : [];
  const links = element => element instanceof Element
    ? [ ...(element.tagName === 'a' ? [element] : []), ...element.children.flatMap(links) ] : [];
  let inboundCalls = 0, actionCalls = 0, failInbounds = false;
  const row = { tag: 'test', remark: 'VLESS', protocol: 'vless', port: 443, transport: 'tcp', enabled: true,
    state: 'closed', rules: [], other: [], action: 'open' };
  handlers.xui_inbounds = () => { inboundCalls++; return failInbounds
    ? { accepted: false, error: 'Панель недоступна' }
    : { accepted: true, snapshot: 'test-snapshot', rows: [row, {...row, tag:'shared', state:'external', action:''}],
      orphans: [{tag:'gone',section:'orphan1',port:'444',transport:'udp',name:'3xUI: gone',enabled:true}] }; };
  handlers.xui_inbounds_action = request => {
    actionCalls++; const value=JSON.parse(request);
    assert.equal(value.snapshot,'test-snapshot'); assert.equal(value.transport,'tcp');
    row.state='open'; row.action='close'; return {accepted:true};
  };
  await view.refreshInbounds();
  assert.equal(links(view.inboundsPanel).find(b=>flat(b).join('')==='Правила firewall').href, '/cgi-bin/luci/admin/network/firewall/rules');
  assert.equal(links(view.inboundsPanel).filter(b=>flat(b).join('')==='Открыть').length,1);
  assert(flat(view.inboundsPanel).includes('Открыт другим правилом'));
  assert(flat(view.inboundsPanel).includes('Правила без соответствующего входящего'));
  assert.equal(buttons(view.inboundsPanel).filter(b=>flat(b).join('')==='Удалить').length,1);
  await links(view.inboundsPanel).find(b=>flat(b).join('')==='Открыть').dispatch('click');
  assert.equal(actionCalls,0,'confirmation before mutation');
  await buttons(new Element('div',{},modal.children)).find(b=>flat(b).join('')==='Открыть').dispatch('click');
  assert.equal(actionCalls,1); assert.equal(inboundCalls,2,'refresh after mutation');
  assert(flat(view.inboundsPanel).includes('Закрыть'));
  failInbounds=true; await view.refreshInbounds();
  assert.equal(view.inboundsSnapshot,null);
  assert(flat(view.inboundsPanel).includes('Панель недоступна'));
  assert(!flat(view.inboundsPanel).includes('Удалить'),'no orphan actions on API failure');
  let certStarts = 0;
  const certState = { accepted:true, running:false, phase:'idle', domain:'vpn.example.com', expires:'',
    panel_scheme:'http', panel_port:'4054', panel_path:'/private/' };
  handlers.xui_cert_status = () => ({...certState});
  handlers.xui_cert_start = domain => {
    assert.equal(domain,'vpn.example.com'); certStarts++;
    Object.assign(certState,{running:true,phase:'running',percent:25,message:'Проверка домена'});
    return {accepted:true};
  };
  await view.issueCertificate();
  assert.equal(certStarts,0,'opening certificate dialog never issues');
  await buttons(new Element('div',{},modal.children)).find(b=>flat(b).join('')==='Выпустить').dispatch('click');
  assert.equal(certStarts,1);
  assert.equal(modal.children[1].children[0].style.width,'25%');
  assert.equal(modal.children[2].textContent,'25%');
  await view.issueCertificate();
  assert.equal(certStarts,1,'running job is observed, not duplicated');
  Object.assign(certState,{running:false,phase:'done',percent:100,expires:'Sep 20 10:00:00 2026 GMT',panel_scheme:'https',panel_domain:'vpn.example.com'});
  view.updateCertificate(certState);
  assert.equal(view.panelLink.href,'https://vpn.example.com:4054/private/');
  assert.equal(view.certDomainValue.textContent,'vpn.example.com');
  view.panelLinks = new Element('span');
  view.updatePanelLinks({ panel_port:'4053', panel_path:'/panel/', panel_scheme:'https', panel_domain:'router.example.com', panel_lan_ip:'192.168.10.1' });
  assert.deepEqual(links(view.panelLinks).map(x=>x.href), ['https://router.example.com:4053/panel/', 'https://192.168.10.1:4053/panel/']);
  view.updatePanelLinks({ panel_port:'8443' });
  assert(links(view.panelLinks).every(x=>x.href.includes(':8443/panel/')));
  console.log('PASS: visible disabled Save, dirty/revert behavior for all settings, automatic token actions, independent routing drafts, link update, errors, neutral colors');
  console.log('PASS: inbound tables, shared permission, orphan delete, confirmation, refresh and API failure');
  console.log('PASS: manual certificate dialog, single job, progress number/bar, certificate fields and HTTPS link');
})().catch(error => { console.error(error); process.exitCode = 1; });
