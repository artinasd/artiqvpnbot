(function () {
  'use strict';
  if (window.__artiqMenuBuilderLoaded) return;
  window.__artiqMenuBuilderLoaded = true;
  var app = document.getElementById('app');
  if (!app) return;
  var state = { actions: {}, draft: null, published: null, history: [], botTexts: {}, botButtons: {}, selectedMenu: 'main', editorMode: 'menu', selectedScreen: 'service_test', previewScreen: 'menu' };
  var card, editor, preview, status;
  function el(tag, text, cls) { var node = document.createElement(tag); if (text !== undefined && text !== null) node.textContent = text; if (cls) node.className = cls; return node; }
  function api(action, extra) {
    var options = { headers: { 'Content-Type': 'application/json', 'x-admin-password': window.__artiqCmsPassword || '' } };
    if (action) { options.method = 'POST'; options.body = JSON.stringify(Object.assign({ action: action }, extra || {})); }
    return fetch('/api/menu-builder', options).then(async function (res) { var data = await res.json().catch(function () { return {}; }); if (!res.ok) throw new Error((data.errors || [data.error || 'Request failed']).join(' · ')); return data; });
  }
  function menu() { return state.draft.menus.find(function (item) { return item.id === state.selectedMenu; }) || state.draft.menus[0]; }
  var defaultScreens = {
    service_test: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'success', buttonControls: {} },
    service_buy: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'primary', buttonControls: {} },
    service_renew: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'success', buttonControls: {} },
    plans_buy: { columns: 1, messageTemplate: '', customPlanButton: true, customPlanLabel: '🛠 ساخت بسته دلخواه (حجم و زمان)', homeButton: true, buttonStyle: 'primary', buttonControls: {} },
    plans_renew: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'success', buttonControls: {} },
    account_list: { columns: 3, messageTemplate: '', homeButton: true, detailLabel: '{title}', renewLabel: '🔁', removeLabel: '❌', buttonControls: {} },
    account_detail: { columns: 2, messageTemplate: '', openLabel: '🔗 باز کردن لینک', copyLabel: '📋 کپی لینک', renewLabel: '🔄 تمدید اشتراک', backLabel: '⬅️ بازگشت به اشتراک‌ها', homeButton: true, buttonControls: {} },
    account_remove: { columns: 2, messageTemplate: '', confirmLabel: '🗑️ بله، حذف اشتراک', cancelLabel: '↩️ انصراف', buttonControls: {} },
    wallet: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {} },
    support: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {} }
  };
  var screenNames = {
    service_test: 'انتخاب سرویس اکانت تست',
    service_buy: 'انتخاب سرویس برای خرید',
    service_renew: 'انتخاب سرویس برای تمدید',
    plans_buy: 'فهرست پلن‌های خرید',
    plans_renew: 'فهرست پلن‌های تمدید',
    account_list: 'فهرست اشتراک‌های حساب',
    account_detail: 'جزئیات اشتراک',
    account_remove: 'تأیید حذف اشتراک',
    wallet: 'صفحه کیف پول',
    support: 'صفحه پشتیبانی'
  };
  function ensureScreens() {
    if (!state.draft.screens || typeof state.draft.screens !== 'object') state.draft.screens = {};
    Object.keys(defaultScreens).forEach(function (id) {
      state.draft.screens[id] = Object.assign({}, defaultScreens[id], state.draft.screens[id] || {});
      if (!Array.isArray(state.draft.screens[id].buttons)) state.draft.screens[id].buttons = [];
    });
  }
  function renderScreenButtons(screenId, cfg) {
    var wrap = el('section', null, 'mb-row');
    wrap.appendChild(el('strong', 'دکمه‌های اضافی این منو', 'mb-screen-title'));
    wrap.appendChild(el('p', 'این دکمه‌ها کنار دکمه‌های زندهٔ سرویس/پلن/اشتراک نمایش داده می‌شوند و عملکرد انتخابی‌شان اجرا می‌شود.', 'mb-description'));
    (cfg.buttons || []).forEach(function (button, index) {
      var item = el('div', null, 'mb-button-edit');
      item.appendChild(field('متن دکمه', button.label, function (v) { button.label = v; renderPreview(); }));
      var actionLabel = el('label', null, 'mb-field'); actionLabel.appendChild(el('span', 'عملکرد دکمه'));
      var select = actionOptions(button.action); actionLabel.appendChild(select); item.appendChild(actionLabel);
      select.addEventListener('change', function () { button.action = select.value; button.params = {}; render(); });
      var styleLabel = el('label', null, 'mb-field'); styleLabel.appendChild(el('span', 'رنگ دکمه'));
      var styleSelect = el('select');
      [['default','پیش‌فرض'],['primary','آبی'],['success','سبز'],['danger','قرمز']].forEach(function (entry) { var opt = el('option', entry[1]); opt.value = entry[0]; opt.selected = (button.style || 'default') === entry[0]; styleSelect.appendChild(opt); });
      styleSelect.addEventListener('change', function () { if (styleSelect.value === 'default') delete button.style; else button.style = styleSelect.value; renderPreview(); });
      styleLabel.appendChild(styleSelect); item.appendChild(styleLabel);
      if (button.action === 'navigate_menu') {
        var menuField = el('label', null, 'mb-field'); menuField.appendChild(el('span', 'منوی مقصد'));
        var menuSelect = el('select');
        state.draft.menus.forEach(function (m) { var opt = el('option', m.name + ' (' + m.id + ')'); opt.value = m.id; opt.selected = m.id === (button.params || {}).menuId; menuSelect.appendChild(opt); });
        menuSelect.addEventListener('change', function () { button.params.menuId = menuSelect.value; }); menuField.appendChild(menuSelect); item.appendChild(menuField);
      }
      if (button.action === 'open_url') item.appendChild(field('لینک HTTPS', (button.params || {}).url, function (v) { button.params.url = v; }, 'https://example.com'));
      item.appendChild(btn('حذف دکمه', 'mb-danger', function () { cfg.buttons.splice(index, 1); render(); }));
      wrap.appendChild(item);
    });
    wrap.appendChild(btn('+ افزودن دکمه', 'mb-secondary', function () {
      if (cfg.buttons.length >= 20) return showStatus('برای هر منو حداکثر ۲۰ دکمهٔ اضافی مجاز است.', false);
      cfg.buttons.push({ id: 'screen_button_' + Math.random().toString(36).slice(2, 7), label: 'دکمه جدید', action: 'back_home', params: {} }); render();
    }));
    return wrap;
  }
  function renderDynamicScreens(selectedScreen) {
    ensureScreens();
    var details = el('details', null, 'mb-dynamic-settings');
    if (selectedScreen) details.open = true;
    var summary = el('summary', selectedScreen ? 'تنظیمات منوی انتخاب‌شده' : 'تنظیمات منوهای پویا (سرویس‌ها، پلن‌ها و اشتراک‌ها)', 'mb-heading');
    details.appendChild(summary);
    details.appendChild(el('p', 'این صفحه‌ها از اطلاعات زنده پنل‌ها، پلن‌ها و حساب کاربر ساخته می‌شوند. متن پیام از جایگزین‌های {service}، {prompt}، {title} و {mode} پشتیبانی می‌کند؛ خالی بگذارید تا متن پیش‌فرض استفاده شود.', 'mb-description'));
    Object.keys(defaultScreens).filter(function (id) { return !selectedScreen || id === selectedScreen; }).forEach(function (id) {
      var cfg = state.draft.screens[id];
      var section = el('section', null, 'mb-row');
      section.appendChild(el('strong', screenNames[id], 'mb-screen-title'));
      var controls = el('div', null, 'mb-screen-controls');
      if (['service_test','service_buy','service_renew','plans_buy','plans_renew','account_list','account_detail','account_remove','wallet','support'].indexOf(id) !== -1) {
        var colWrap = el('label', null, 'mb-field'); colWrap.appendChild(el('span', 'تعداد دکمه در هر ردیف'));
        var colSelect = el('select');
        [1,2,3,4].forEach(function (n) { var opt = el('option', String(n)); opt.value = String(n); opt.selected = Number(cfg.columns || 1) === n; colSelect.appendChild(opt); });
        colSelect.addEventListener('change', function () { cfg.columns = Number(colSelect.value); renderPreview(); });
        colWrap.appendChild(colSelect); controls.appendChild(colWrap);
        if (!Array.isArray(cfg.rowLayout)) cfg.rowLayout = [];
        var rowLayoutWrap = el('div', null, 'mb-row-layout');
        rowLayoutWrap.appendChild(el('span', 'چیدمان جداگانه ردیف‌ها', 'mb-screen-title'));
        rowLayoutWrap.appendChild(el('p', 'برای هر ردیف تعداد دکمه را جداگانه تعیین کنید؛ مثلاً ۱، سپس ۳، سپس ۲. ردیف‌های تعریف‌نشده از تنظیم «تعداد دکمه در هر ردیف» استفاده می‌کنند.', 'mb-description'));
        cfg.rowLayout.forEach(function (width, rowIndex) {
          var rowSetting = el('div', null, 'mb-row-layout-item');
          var rowLabel = el('label', null, 'mb-field'); rowLabel.appendChild(el('span', 'ردیف ' + (rowIndex + 1)));
          var rowSelect = el('select');
          [1,2,3,4].forEach(function (n) { var opt = el('option', n + ' دکمه'); opt.value = String(n); opt.selected = Number(width) === n; rowSelect.appendChild(opt); });
          rowSelect.addEventListener('change', function () { cfg.rowLayout[rowIndex] = Number(rowSelect.value); renderPreview(); });
          rowLabel.appendChild(rowSelect); rowSetting.appendChild(rowLabel);
          rowSetting.appendChild(btn('حذف ردیف', 'mb-danger', function () { cfg.rowLayout.splice(rowIndex, 1); render(); }));
          rowLayoutWrap.appendChild(rowSetting);
        });
        rowLayoutWrap.appendChild(btn('+ افزودن تنظیم ردیف', 'mb-secondary', function () {
          if (cfg.rowLayout.length >= 30) return showStatus('حداکثر ۳۰ تنظیم ردیف مجاز است.', false);
          cfg.rowLayout.push(Math.max(1, Math.min(4, Number(cfg.columns) || 1))); render();
        }));
        controls.appendChild(rowLayoutWrap);
      }
      if (['service_test','service_buy','service_renew','plans_buy','plans_renew'].indexOf(id) !== -1) {
        var styleWrap = el('label', null, 'mb-field'); styleWrap.appendChild(el('span', 'رنگ دکمه در تلگرام'));
        var styleSelect = el('select');
        [['default','پیش‌فرض'],['primary','آبی'],['success','سبز'],['danger','قرمز']].forEach(function (entry) { var opt = el('option', entry[1]); opt.value = entry[0]; opt.selected = (cfg.buttonStyle || (id === 'service_test' || id === 'service_renew' || id === 'plans_renew' ? 'success' : 'primary')) === entry[0]; styleSelect.appendChild(opt); });
        styleSelect.addEventListener('change', function () { cfg.buttonStyle = styleSelect.value; renderPreview(); });
        styleWrap.appendChild(styleSelect); controls.appendChild(styleWrap);
      }
      var msgWrap = el('label', null, 'mb-field'); msgWrap.appendChild(el('span', 'قالب متن پیام'));
      var msg = el('textarea'); msg.rows = 2; msg.value = cfg.messageTemplate || ''; msg.placeholder = '{service}\\n\\n{prompt}'; msg.addEventListener('input', function () { cfg.messageTemplate = msg.value; renderPreview(); });
      msgWrap.appendChild(msg); controls.appendChild(msgWrap);
      if (id !== 'account_remove') {
        var homeWrap = el('label', null, 'mb-check-field'); var home = el('input'); home.type = 'checkbox'; home.checked = cfg.homeButton !== false;
        home.addEventListener('change', function () { cfg.homeButton = home.checked; renderPreview(); }); homeWrap.appendChild(home); homeWrap.appendChild(el('span', 'نمایش دکمه منوی اصلی')); controls.appendChild(homeWrap);
      }
      if (id === 'plans_buy') {
        var customWrap = el('label', null, 'mb-check-field'); var custom = el('input'); custom.type = 'checkbox'; custom.checked = cfg.customPlanButton !== false;
        custom.addEventListener('change', function () { cfg.customPlanButton = custom.checked; renderPreview(); }); customWrap.appendChild(custom); customWrap.appendChild(el('span', 'نمایش دکمه ساخت بسته دلخواه')); controls.appendChild(customWrap);
        var customLabel = field('متن دکمه بسته دلخواه', cfg.customPlanLabel, function (v) { cfg.customPlanLabel = v; }); controls.appendChild(customLabel);
      }
      if (id === 'account_list') {
        controls.appendChild(field('متن دکمه اشتراک (از {title} استفاده کنید)', cfg.detailLabel, function (v) { cfg.detailLabel = v; }));
        controls.appendChild(field('متن دکمه تمدید', cfg.renewLabel, function (v) { cfg.renewLabel = v; }));
        controls.appendChild(field('متن دکمه حذف', cfg.removeLabel, function (v) { cfg.removeLabel = v; }));
      }
      if (id === 'account_detail') {
        controls.appendChild(field('متن دکمه باز کردن لینک', cfg.openLabel, function (v) { cfg.openLabel = v; }));
        controls.appendChild(field('متن دکمه کپی لینک', cfg.copyLabel, function (v) { cfg.copyLabel = v; }));
        controls.appendChild(field('متن دکمه تمدید', cfg.renewLabel, function (v) { cfg.renewLabel = v; }));
        controls.appendChild(field('متن دکمه بازگشت', cfg.backLabel, function (v) { cfg.backLabel = v; }));
      }
      if (id === 'account_remove') {
        controls.appendChild(field('متن دکمه تأیید حذف', cfg.confirmLabel, function (v) { cfg.confirmLabel = v; }));
        controls.appendChild(field('متن دکمه انصراف', cfg.cancelLabel, function (v) { cfg.cancelLabel = v; }));
      }
      if (['service_test','service_buy','service_renew','plans_buy','plans_renew'].indexOf(id) !== -1) {
        if (!cfg.buttonControls || typeof cfg.buttonControls !== 'object') cfg.buttonControls = {};
        var groups = [
          { id: 'services', label: 'دکمه‌های سرویس زنده' },
          { id: 'plans', label: 'دکمه‌های پلن زنده' }
        ];
        if (id === 'plans_buy') groups.push({ id: 'custom_plan', label: 'دکمه ساخت بسته دلخواه' });
        var builtInWrap = el('section', null, 'mb-row');
        builtInWrap.appendChild(el('strong', 'کنترل دکمه‌های موجود', 'mb-screen-title'));
        builtInWrap.appendChild(el('p', 'برای هر گروه می‌توانید نمایش، متن، رنگ و عملکرد را تغییر دهید. از {label} در متن استفاده کنید تا متن اصلی هر سرویس یا پلن حفظ شود. «عملکرد اصلی» نگه‌داشتن callback شناسه‌دار ربات است.', 'mb-description'));
        groups.forEach(function (group) {
          var control = cfg.buttonControls[group.id] || (cfg.buttonControls[group.id] = { enabled: true, label: '{label}', action: 'original', style: 'default', params: {} });
          var card = el('div', null, 'mb-button-edit');
          var enabledWrap = el('label', null, 'mb-check-field'); var enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = control.enabled !== false;
          enabled.addEventListener('change', function () { control.enabled = enabled.checked; renderPreview(); });
          enabledWrap.appendChild(enabled); enabledWrap.appendChild(el('span', 'نمایش ' + group.label)); card.appendChild(enabledWrap);
          card.appendChild(field('الگوی متن (' + group.label + ')', control.label || '{label}', function (v) { control.label = v; }));
          var actionWrap = el('label', null, 'mb-field'); actionWrap.appendChild(el('span', 'عملکرد'));
          var actionSelect = el('select');
          [['original','عملکرد اصلی ربات']].concat(Object.keys(state.actions).map(function (key) { return [key, state.actions[key].label]; })).forEach(function (entry) {
            var opt = el('option', entry[1]); opt.value = entry[0]; opt.selected = (control.action || 'original') === entry[0]; actionSelect.appendChild(opt);
          });
          actionSelect.addEventListener('change', function () { control.action = actionSelect.value; control.params = {}; render(); });
          actionWrap.appendChild(actionSelect); card.appendChild(actionWrap);
          var styleWrap = el('label', null, 'mb-field'); styleWrap.appendChild(el('span', 'رنگ'));
          var styleSelect = el('select');
          [['default','پیش‌فرض'],['primary','آبی'],['success','سبز'],['danger','قرمز']].forEach(function (entry) { var opt = el('option', entry[1]); opt.value = entry[0]; opt.selected = (control.style || 'default') === entry[0]; styleSelect.appendChild(opt); });
          styleSelect.addEventListener('change', function () { control.style = styleSelect.value; renderPreview(); });
          styleWrap.appendChild(styleSelect); card.appendChild(styleWrap);
          if (control.action === 'navigate_menu') {
            var targetWrap = el('label', null, 'mb-field'); targetWrap.appendChild(el('span', 'منوی مقصد'));
            var targetSelect = el('select');
            state.draft.menus.forEach(function (m) { var opt = el('option', m.name + ' (' + m.id + ')'); opt.value = m.id; opt.selected = m.id === (control.params || {}).menuId; targetSelect.appendChild(opt); });
            targetSelect.addEventListener('change', function () { control.params.menuId = targetSelect.value; });
            targetWrap.appendChild(targetSelect); card.appendChild(targetWrap);
          }
          if (control.action === 'open_url') card.appendChild(field('لینک HTTPS', (control.params || {}).url, function (v) { control.params.url = v; }, 'https://example.com'));
          builtInWrap.appendChild(card);
        });
        section.appendChild(builtInWrap);
      }
      var roleGroups = {
        account_list: [{id:'subscription_detail',label:'باز کردن جزئیات اشتراک'},{id:'subscription_renew',label:'تمدید اشتراک'},{id:'subscription_remove',label:'حذف اشتراک'},{id:'home',label:'منوی اصلی'}],
        account_detail: [{id:'open_link',label:'باز کردن لینک اشتراک'},{id:'copy_link',label:'کپی لینک اشتراک'},{id:'renew_subscription',label:'تمدید اشتراک'},{id:'back_to_list',label:'بازگشت به فهرست'},{id:'home',label:'منوی اصلی'}],
        account_remove: [{id:'confirm_remove',label:'تأیید حذف'},{id:'cancel_remove',label:'انصراف از حذف'}]
      };
      if (roleGroups[id]) {
        if (!cfg.buttonControls || typeof cfg.buttonControls !== 'object') cfg.buttonControls = {};
        var rolesWrap = el('section', null, 'mb-row');
        rolesWrap.appendChild(el('strong', 'کنترل جداگانه دکمه‌های موجود', 'mb-screen-title'));
        rolesWrap.appendChild(el('p', 'هر دکمه را مستقل پنهان کنید، متن و رنگش را عوض کنید یا عملکردش را تغییر دهید. برای حفظ شناسه اشتراک و عملکرد اصلی، «عملکرد اصلی ربات» را انتخاب کنید.', 'mb-description'));
        roleGroups[id].forEach(function (role) {
          var c = cfg.buttonControls[role.id] || (cfg.buttonControls[role.id] = { enabled: true, label: '{label}', action: 'original', style: 'default', params: {} });
          var item = el('div', null, 'mb-button-edit'), showWrap = el('label', null, 'mb-check-field'), show = el('input'); show.type = 'checkbox'; show.checked = c.enabled !== false;
          show.addEventListener('change', function () { c.enabled = show.checked; renderPreview(); }); showWrap.appendChild(show); showWrap.appendChild(el('span', 'نمایش ' + role.label)); item.appendChild(showWrap);
          item.appendChild(field('الگوی متن (' + role.label + ')', c.label || '{label}', function (v) { c.label = v; }));
          var aw = el('label', null, 'mb-field'); aw.appendChild(el('span', 'عملکرد')); var as = el('select');
          [['original','عملکرد اصلی ربات']].concat(Object.keys(state.actions).map(function (k) { return [k,state.actions[k].label]; })).forEach(function (x) { var o = el('option',x[1]); o.value=x[0]; o.selected=(c.action||'original')===x[0]; as.appendChild(o); });
          as.addEventListener('change',function(){c.action=as.value;c.params={};render();}); aw.appendChild(as); item.appendChild(aw);
          var sw=el('label',null,'mb-field'); sw.appendChild(el('span','رنگ')); var ss=el('select');
          [['default','پیش‌فرض'],['primary','آبی'],['success','سبز'],['danger','قرمز']].forEach(function(x){var o=el('option',x[1]);o.value=x[0];o.selected=(c.style||'default')===x[0];ss.appendChild(o);});
          ss.addEventListener('change',function(){c.style=ss.value;renderPreview();});sw.appendChild(ss);item.appendChild(sw);
          if(c.action==='navigate_menu'){var tw=el('label',null,'mb-field');tw.appendChild(el('span','منوی مقصد'));var ts=el('select');state.draft.menus.forEach(function(m){var o=el('option',m.name+' ('+m.id+')');o.value=m.id;o.selected=m.id===(c.params||{}).menuId;ts.appendChild(o);});ts.addEventListener('change',function(){c.params.menuId=ts.value;});tw.appendChild(ts);item.appendChild(tw);}
          if(c.action==='open_url')item.appendChild(field('لینک HTTPS',(c.params||{}).url,function(v){c.params.url=v;},'https://example.com'));
          rolesWrap.appendChild(item);
        });
        section.appendChild(rolesWrap);
      }
      section.appendChild(controls); section.appendChild(renderScreenButtons(id, cfg)); details.appendChild(section);
    });
    return details;
  }
  function actionOptions(selected) {
    var select = el('select');
    Object.keys(state.actions).forEach(function (key) { var option = el('option', state.actions[key].label); option.value = key; if (key === selected) option.selected = true; select.appendChild(option); });
    return select;
  }
  function field(label, value, onChange, placeholder) {
    var wrap = el('label', null, 'mb-field'); wrap.appendChild(el('span', label));
    var input = el('input'); input.value = value || ''; input.placeholder = placeholder || '';
    input.addEventListener('input', function () { onChange(input.value); renderPreview(); });
    wrap.appendChild(input); return wrap;
  }
  function btn(text, cls, handler) { var b = el('button', text, cls || 'mb-button'); b.type = 'button'; b.addEventListener('click', handler); return b; }
  function currentMenusSelect() {
    var select = el('select');
    select.setAttribute('aria-label', 'ویرایشگر منو');
    var customGroup = el('optgroup'); customGroup.label = 'منوهای اصلی و زیرمنوها';
    state.draft.menus.forEach(function (item) {
      var opt = el('option', item.name + ' (' + item.id + ')'); opt.value = 'menu:' + item.id;
      opt.selected = state.editorMode === 'menu' && item.id === state.selectedMenu; customGroup.appendChild(opt);
    });
    select.appendChild(customGroup);
    var screenGroup = el('optgroup'); screenGroup.label = 'منوهای موجود ربات';
    Object.keys(defaultScreens).forEach(function (id) {
      var opt = el('option', screenNames[id]); opt.value = 'screen:' + id;
      opt.selected = state.editorMode === 'screen' && id === state.selectedScreen; screenGroup.appendChild(opt);
    });
    select.appendChild(screenGroup);
    select.addEventListener('change', function () {
      var value = select.value.split(':');
      if (value[0] === 'screen') { state.editorMode = 'screen'; state.selectedScreen = value.slice(1).join(':'); state.previewScreen = state.selectedScreen; }
      else { state.editorMode = 'menu'; state.selectedMenu = value.slice(1).join(':'); state.previewScreen = 'menu'; }
      render();
    });
    return select;
  }
  function addMenu() {
    var id = 'menu_' + Math.random().toString(36).slice(2, 7);
    state.draft.menus.push({ id: id, name: 'منوی جدید', text: 'لطفاً یکی از گزینه‌ها را انتخاب کنید:', rows: [{ id: 'row_1', buttons: [{ id: 'home', label: '🏠 Main menu', action: 'back_home', params: {} }] }] });
    state.selectedMenu = id; state.editorMode = 'menu'; state.previewScreen = 'menu'; render();
  }
  function render() {
    if (!state.draft) return;
    var selected = menu();
    editor.replaceChildren();
    var top = el('div', null, 'mb-toolbar');
    top.appendChild(el('div', 'ویرایشگر منو', 'mb-heading'));
    top.appendChild(currentMenusSelect());
    if (state.editorMode === 'menu') top.appendChild(btn('+ افزودن منو', 'mb-secondary', addMenu));
    if (state.editorMode === 'menu' && selected.id !== 'main') top.appendChild(btn('حذف منو', 'mb-danger', function () {
      if (!window.confirm('این منو حذف شود؟ دکمه‌هایی که به آن اشاره می‌کنند نیز باید اصلاح شوند.')) return;
      state.draft.menus = state.draft.menus.filter(function (m) { return m.id !== selected.id; });
      state.draft.menus.forEach(function (m) { m.rows.forEach(function (r) { r.buttons = r.buttons.filter(function (b) { return !(b.action === 'navigate_menu' && b.params.menuId === selected.id); }); }); });
      state.selectedMenu = 'main'; render();
    }));
    editor.appendChild(top);
    if (state.editorMode === 'screen') {
      editor.appendChild(el('p', 'این‌ها منوهای موجود ربات هستند؛ تنظیمات صفحهٔ انتخاب‌شده را از اینجا ویرایش کنید.', 'mb-description'));
      editor.appendChild(renderDynamicScreens(state.selectedScreen));
      renderPreview();
      return;
    }
    var basics = el('div', null, 'mb-basics');
    basics.appendChild(field('نام منو', selected.name, function (v) { selected.name = v; }));
    var idField = field('شناسه منو', selected.id, function () {}, 'هنگام ساخت منو تعیین می‌شود'); idField.querySelector('input').readOnly = true; basics.appendChild(idField);
    basics.appendChild(field('متن پیام', selected.text, function (v) { selected.text = v; renderPreview(); }));
    editor.appendChild(basics);
    editor.appendChild(el('div', 'چیدمان دکمه‌ها', 'mb-heading'));
    var rows = el('div', null, 'mb-rows');
    selected.rows.forEach(function (row, rowIndex) {
      var rowCard = el('section', null, 'mb-row');
      var rowHead = el('div', null, 'mb-row-head');
      rowHead.appendChild(el('strong', 'ردیف ' + (rowIndex + 1)));
      rowHead.appendChild(btn('↑', 'mb-icon-button', function () { if (rowIndex > 0) { var tmp = selected.rows[rowIndex - 1]; selected.rows[rowIndex - 1] = row; selected.rows[rowIndex] = tmp; render(); } }));
      rowHead.appendChild(btn('↓', 'mb-icon-button', function () { if (rowIndex < selected.rows.length - 1) { var tmp = selected.rows[rowIndex + 1]; selected.rows[rowIndex + 1] = row; selected.rows[rowIndex] = tmp; render(); } }));
      rowHead.appendChild(btn('حذف ردیف', 'mb-danger', function () { selected.rows.splice(rowIndex, 1); render(); }));
      rowCard.appendChild(rowHead);
      var buttons = el('div', null, 'mb-button-edit-grid');
      row.buttons.forEach(function (button, buttonIndex) {
        var item = el('div', null, 'mb-button-edit');
        item.appendChild(field('متن دکمه در تلگرام', button.label, function (v) { button.label = v; }));
        var actionLabel = el('label', null, 'mb-field'); actionLabel.appendChild(el('span', 'عملکرد دکمه'));
        var select = actionOptions(button.action); actionLabel.appendChild(select); item.appendChild(actionLabel);
        select.addEventListener('change', function () { button.action = select.value; button.params = {}; render(); });
        var styleLabel = el('label', null, 'mb-field'); styleLabel.appendChild(el('span', 'رنگ بومی دکمه در تلگرام'));
        var styleSelect = el('select');
        [['default','پیش‌فرض'],['primary','آبی'],['success','سبز'],['danger','قرمز']].forEach(function (entry) { var opt = el('option', entry[1]); opt.value = entry[0]; opt.selected = (button.style || 'default') === entry[0]; styleSelect.appendChild(opt); });
        styleSelect.addEventListener('change', function () { if (styleSelect.value === 'default') delete button.style; else button.style = styleSelect.value; renderPreview(); });
        styleLabel.appendChild(styleSelect); item.appendChild(styleLabel);
        if (button.action === 'navigate_menu') {
          var menuField = el('label', null, 'mb-field'); menuField.appendChild(el('span', 'منوی مقصد'));
          var menuSelect = el('select');
          state.draft.menus.filter(function (m) { return m.id !== selected.id || m.id === button.params.menuId; }).forEach(function (m) { var opt = el('option', m.name + ' (' + m.id + ')'); opt.value = m.id; opt.selected = m.id === button.params.menuId; menuSelect.appendChild(opt); });
          menuSelect.addEventListener('change', function () { button.params.menuId = menuSelect.value; }); menuField.appendChild(menuSelect); item.appendChild(menuField);
        }
        if (button.action === 'open_url') item.appendChild(field('لینک HTTPS', button.params.url, function (v) { button.params.url = v; }, 'https://example.com'));
        var controls = el('div', null, 'mb-item-controls');
        controls.appendChild(btn('←', 'mb-icon-button', function () { if (buttonIndex > 0) { row.buttons.splice(buttonIndex, 1); row.buttons.splice(buttonIndex - 1, 0, button); render(); } }));
        controls.appendChild(btn('→', 'mb-icon-button', function () { if (buttonIndex < row.buttons.length - 1) { row.buttons.splice(buttonIndex, 1); row.buttons.splice(buttonIndex + 1, 0, button); render(); } }));
        controls.appendChild(btn('حذف دکمه', 'mb-danger', function () { row.buttons.splice(buttonIndex, 1); render(); }));
        item.appendChild(controls); buttons.appendChild(item);
      });
      rowCard.appendChild(buttons);
      rowCard.appendChild(btn('+ افزودن دکمه به این ردیف', 'mb-secondary', function () {
        if (row.buttons.length >= 8) return showStatus('در هر ردیف حداکثر ۸ دکمه مجاز است.', false);
        row.buttons.push({ id: 'button_' + Math.random().toString(36).slice(2, 7), label: 'New button', action: 'back_home', params: {} }); render();
      }));
      rows.appendChild(rowCard);
    });
    editor.appendChild(rows);
    editor.appendChild(btn('+ افزودن ردیف', 'mb-secondary', function () { selected.rows.push({ id: 'row_' + Math.random().toString(36).slice(2, 7), buttons: [] }); render(); }));
    editor.appendChild(renderDynamicScreens());
    renderPreview();
  }
  function normalizePreviewText(value) {
    return String(value == null ? '' : value)
      .replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n')
      .replace(/<br\\s*\\/?\s*>/gi, '\n').replace(/<\\/(?:p|div|li)>/gi, '\n')
      .replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
      .trim();
  }
  function renderPreview() {
    if (!preview || !state.draft) return;
    ensureScreens();
    preview.replaceChildren();
    preview.appendChild(el('div', 'پیش‌نمایش تلگرام', 'mb-preview-kicker'));
    var chooser = el('label', null, 'mb-field'); chooser.appendChild(el('span', 'نمایش پیش‌نمایش'));
    var select = el('select');
    [['menu','منوی انتخاب‌شده'],['service_test','انتخاب سرویس تست'],['service_buy','انتخاب سرویس خرید'],['service_renew','انتخاب سرویس تمدید'],['plans_buy','پلن‌های خرید'],['plans_renew','پلن‌های تمدید'],['account_list','فهرست اشتراک‌ها'],['account_detail','جزئیات اشتراک'],['account_remove','تأیید حذف اشتراک'],['wallet','کیف پول'],['support','پشتیبانی']].forEach(function (entry) { var opt = el('option', entry[1]); opt.value = entry[0]; opt.selected = state.previewScreen === entry[0]; select.appendChild(opt); });
    select.addEventListener('change', function () { state.previewScreen = select.value; renderPreview(); });
    chooser.appendChild(select); preview.appendChild(chooser);
    var title = 'Artiq VPN';
    var message = '';
    var rows = [];
    var style = 'default';
    if (state.previewScreen === 'menu') {
      var selected = menu(); message = selected.text || 'متن پیام در این قسمت نمایش داده می‌شود.';
      rows = selected.rows.map(function (row) { return row.buttons.map(function (button) { return { label: button.label || 'Button', style: button.style || 'default' }; }); });
    } else {
      var cfg = state.draft.screens[state.previewScreen] || {};
      var samples = {
        service_test: { title: 'انتخاب سرویس اکانت تست', message: 'سرویس موردنظر را برای اکانت تست انتخاب کنید:', rows: [['🧩 سرویس اصلی'],['🎮 سرویس گیمینگ'],['🏠 منوی اصلی']] },
        service_buy: { title: 'انتخاب سرویس برای خرید', message: 'ابتدا سرویس موردنظر را انتخاب کنید:', rows: [['🧩 سرویس اصلی'],['⚡ سرویس مستقیم'],['🏠 منوی اصلی']] },
        service_renew: { title: 'انتخاب سرویس برای تمدید', message: 'سرویس اشتراک خود را انتخاب کنید:', rows: [['🧩 سرویس اصلی'],['🎮 سرویس گیمینگ'],['🏠 منوی اصلی']] },
        plans_buy: { title: 'پلن‌های خرید', message: '{service}\\n\\n{prompt}', rows: [['📦 پلن ۱۰ گیگ — ۲۰۰٬۰۰۰ تومان'],['📦 پلن ۳۰ گیگ — ۵۰۰٬۰۰۰ تومان'],['🛠 ساخت بسته دلخواه'],['🏠 منوی اصلی']] },
        plans_renew: { title: 'پلن‌های تمدید', message: '{service}\\n\\n{prompt}', rows: [['🔄 پلن ۱۰ گیگ'],['🔄 پلن ۳۰ گیگ'],['🏠 منوی اصلی']] },
        account_list: { title: 'حساب من', message: 'اشتراک موردنظر را انتخاب کنید:', rows: [['اشتراک من','🔁','❌'],['🏠 منوی اصلی']] },
        account_detail: { title: 'جزئیات اشتراک', message: '📦 اشتراک ۱۰ گیگ\\nوضعیت: فعال', rows: [['🔗 باز کردن لینک','📋 کپی لینک'],['🔄 تمدید اشتراک'],['⬅️ بازگشت به اشتراک‌ها'],['🏠 منوی اصلی']] },
        account_remove: { title: 'تأیید حذف اشتراک', message: 'آیا از حذف این اشتراک مطمئن هستید؟', rows: [['🗑️ بله، حذف اشتراک'],['↩️ انصراف']] },
        wallet: { title: 'کیف پول', message: 'موجودی فعلی: ۰ تومان\\nمبلغ شارژ را وارد کنید.', rows: [['🏠 منوی اصلی']] },
        support: { title: 'پشتیبانی', message: 'برای دریافت پشتیبانی با ما در ارتباط باشید.', rows: [['🏠 منوی اصلی']] }
      };
      var sample = samples[state.previewScreen] || samples.service_buy;
      title = sample.title;
      var botTexts = state.botTexts || {};
      var actualMessages = {
        service_test: botTexts.serviceSelectionTest,
        service_buy: botTexts.serviceSelectionBuy,
        service_renew: botTexts.serviceSelectionRenew,
        plans_buy: '{service}\\n\\n{prompt}',
        plans_renew: '{service}\\n\\n{prompt}',
        support: botTexts.support
      };
      if (state.previewScreen === 'plans_buy' || state.previewScreen === 'plans_renew') actualMessages[state.previewScreen] = '{service}\\n\\n' + (botTexts.planPrompt || 'لطفاً بسته مورد نظر را انتخاب کنید:');
      var values = { service: 'سرویس اصلی', prompt: botTexts.planPrompt || 'لطفاً بسته مورد نظر را انتخاب کنید:', title: sample.title, mode: state.previewScreen.indexOf('renew') !== -1 ? 'تمدید' : 'خرید', support_username: 'نام کاربری پشتیبانی' };
      var template = String(cfg.messageTemplate || '').trim() || actualMessages[state.previewScreen] || sample.message;
      message = template.replace(/\{(service|prompt|title|mode|support_username)\}/g, function (_, key) { return values[key] || ''; });
      rows = sample.rows.map(function (row) { return row.map(function (label) { return { label: label, style: 'default' }; }); });
      style = cfg.buttonStyle || 'default';
      if (state.previewScreen === 'plans_buy') {
        if (cfg.customPlanButton === false) rows = rows.filter(function (row) { return row[0].label !== '🛠 ساخت بسته دلخواه'; });
        else if (cfg.customPlanLabel) rows[rows.length - 2][0].label = cfg.customPlanLabel;
      }
      if (state.previewScreen === 'account_list') {
        rows[0][0].label = String(cfg.detailLabel || '{title}').replace(/\{title\}/g, 'اشتراک من');
        rows[0][1].label = cfg.renewLabel || '🔁'; rows[0][2].label = cfg.removeLabel || '❌';
      }
      if (state.previewScreen === 'account_detail') {
        rows[0][0].label = cfg.openLabel || '🔗 باز کردن لینک'; rows[0][1].label = cfg.copyLabel || '📋 کپی لینک';
        rows[1][0].label = cfg.renewLabel || '🔄 تمدید اشتراک'; rows[2][0].label = cfg.backLabel || '⬅️ بازگشت به اشتراک‌ها';
        if (cfg.homeButton === false) rows.pop();
      }
      if (state.previewScreen === 'account_remove') { rows[0][0].label = cfg.confirmLabel || '🗑️ بله، حذف اشتراک'; rows[1][0].label = cfg.cancelLabel || '↩️ انصراف'; }
      if (cfg.homeButton === false && ['service_test','service_buy','service_renew','plans_buy','plans_renew','account_list','wallet','support'].indexOf(state.previewScreen) !== -1) rows = rows.filter(function (row) { return row[0] && row[0].label !== '🏠 منوی اصلی'; });
      (cfg.buttonControls && Object.keys(cfg.buttonControls)).forEach(function (groupId) {
        var control = cfg.buttonControls[groupId];
        if (!control || control.enabled === false) {
          if (groupId === 'custom_plan') rows = rows.filter(function (row) { return !row.some(function (b) { return /ساخت بسته دلخواه/.test(b.label); }); });
          else if (groupId === 'services') rows = rows.filter(function (row) { return !row.some(function (b) { return /سرویس اصلی|سرویس گیمینگ|سرویس مستقیم/.test(b.label); }); });
          else if (groupId === 'plans') rows = rows.filter(function (row) { return !row.some(function (b) { return /پلن/.test(b.label); }); });
          return;
        }
        rows.forEach(function (row) { row.forEach(function (button) {
          var matches = groupId === 'custom_plan' ? /ساخت بسته دلخواه/.test(button.label) : groupId === 'services' ? /سرویس اصلی|سرویس گیمینگ|سرویس مستقیم/.test(button.label) : /پلن/.test(button.label);
          if (matches) { button.label = String(control.label || '{label}').replace(/\{label\}/g, button.label); button.style = control.style || 'default'; }
        }); });
      });
      if (cfg.buttonControls) {
        var roles = {account_list:['subscription_detail','subscription_renew','subscription_remove','home'],account_detail:['open_link','copy_link','renew_subscription','back_to_list','home'],account_remove:['confirm_remove','cancel_remove']}[state.previewScreen] || [];
        var matchers = {subscription_detail:/اشتراک من/,subscription_renew:/🔁/,subscription_remove:/❌/,open_link:/باز کردن لینک/,copy_link:/کپی لینک/,renew_subscription:/تمدید اشتراک/,back_to_list:/بازگشت به اشتراک‌ها/,confirm_remove:/بله، حذف اشتراک/,cancel_remove:/انصراف/,home:/منوی اصلی/};
        roles.forEach(function(id){var c=cfg.buttonControls[id];if(!c)return;rows.forEach(function(row){row.forEach(function(b){if(!matchers[id].test(b.label))return;if(c.enabled===false)b.__hidden=true;else{b.label=String(c.label||'{label}').replace(/\\{label\\}/g,b.label);b.style=c.style||'default';}});});});
        rows=rows.map(function(row){return row.filter(function(b){return !b.__hidden;});}).filter(function(row){return row.length;});
      }
      (cfg.buttons || []).forEach(function (button) { rows.push([{ label: button.label || 'دکمه جدید', style: button.style || 'default' }]); });
      if (Array.isArray(cfg.rowLayout) && cfg.rowLayout.length) {
        var flat = rows.flat(); rows = []; var offset = 0;
        cfg.rowLayout.forEach(function (rowWidth) { var width = Math.max(1, Math.min(4, Number(rowWidth) || 1)); if (offset < flat.length) { rows.push(flat.slice(offset, offset + width)); offset += width; } });
        var fallbackWidth = Math.max(1, Math.min(4, Number(cfg.columns) || 1));
        while (offset < flat.length) { rows.push(flat.slice(offset, offset + fallbackWidth)); offset += fallbackWidth; }
      } else if (Number(cfg.columns)>0) { var width=Math.max(1,Math.min(4,Number(cfg.columns)||1)), flat=rows.flat(); rows=[]; for(var ri=0;ri<flat.length;ri+=width) rows.push(flat.slice(ri,ri+width)); }
    }
    preview.appendChild(el('div', title, 'mb-preview-name'));
    preview.appendChild(el('div', normalizePreviewText(message || 'متن پیام در این قسمت نمایش داده می‌شود.'), 'mb-preview-text'));
    var keyboard = el('div', null, 'mb-preview-keyboard');
    rows.forEach(function (row) {
      var line = el('div', null, 'mb-preview-row');
      row.forEach(function (button) { line.appendChild(el('div', button.label || 'Button', 'mb-preview-button mb-style-' + (button.style || style || 'default'))); });
      keyboard.appendChild(line);
    });
    preview.appendChild(keyboard);
    preview.appendChild(el('div', 'این پیش‌نمایش نمونه است؛ سرویس‌ها و پلن‌های واقعی هنگام اجرا از داده‌های فعال خوانده می‌شوند.', 'mb-preview-note'));
  }
  function showStatus(text, good) { status.replaceChildren(el('div', text, good ? 'mb-ok' : 'mb-error')); }
  function mount() {
    if (document.getElementById('menuBuilderCard')) return;
    card = el('section', null, 'card'); card.id = 'menuBuilderCard';
    card.appendChild(el('h3', '🧩 سازنده بصری منو'));
    card.appendChild(el('p', 'منوی اصلی و زیرمنوها را بسازید، دکمه‌ها را در ردیف‌ها بچینید و برای هر دکمه یک عملکرد ثبت‌شده انتخاب کنید.', 'mb-description'));
    var layout = el('div', null, 'mb-layout');
    editor = el('div', null, 'mb-editor'); preview = el('div', null, 'mb-preview');
    layout.appendChild(editor); layout.appendChild(preview); card.appendChild(layout);
    var actions = el('div', null, 'mb-publish-actions');
    actions.appendChild(btn('ذخیره پیش‌نویس', 'mb-secondary', async function () { try { var result = await api('save_draft', { document: state.draft }); state.draft = result.draft; showStatus('پیش‌نویس ذخیره شد؛ تا زمان انتشار در ربات فعال نمی‌شود.', true); } catch (e) { showStatus(e.message, false); } }));
    actions.appendChild(btn('انتشار در ربات', 'mb-button', async function () { if (!window.confirm('این تنظیمات منو در ربات فعال منتشر شود؟')) return; try { await api('save_draft', { document: state.draft }); var result = await api('publish'); state.published = result.published; showStatus('نسخه منتشرشده ' + result.published.version + '؛ ربات از این تنظیمات برای پیام‌های منو استفاده می‌کند.', true); } catch (e) { showStatus(e.message, false); } }));
    var historySelect = el('select'); historySelect.setAttribute('aria-label', 'نسخه قبلی منتشرشده');
    actions.appendChild(historySelect);
    actions.appendChild(btn('بازگردانی نسخه', 'mb-danger', async function () { var version = Number(historySelect.value); if (!version || !window.confirm('به نسخه ' + version + ' بازگردانی شود؟')) return; try { var result = await api('rollback', { version: version }); state.published = result.published; showStatus('به نسخه ' + version + '.', true); } catch (e) { showStatus(e.message, false); } }));
    card.appendChild(actions); status = el('div'); card.appendChild(status);
    app.insertBefore(card, app.firstChild);
    api().then(function (data) {
      state.actions = data.actions || {}; state.botTexts = data.botTexts || {}; state.botButtons = data.botButtons || {}; state.draft = data.draft; ensureScreens(); state.published = data.published; state.history = data.history || [];
      historySelect.replaceChildren();
      state.history.forEach(function (item) { var opt = el('option', 'نسخه ' + item.version + (item.publishedAt ? ' · ' + item.publishedAt : '')); opt.value = item.version; historySelect.appendChild(opt); });
      if (!state.history.length) { var opt = el('option', 'نسخه قبلی وجود ندارد'); opt.value = ''; historySelect.appendChild(opt); }
      render();
    }).catch(function (error) { showStatus('بارگذاری تنظیمات منو ناموفق بود: ' + error.message, false); });
  }
  var timer = setInterval(function () {
    if (window.__artiqCmsPassword && document.getElementById('app') && !document.getElementById('app').classList.contains('hidden')) { clearInterval(timer); mount(); }
  }, 250);
}());
