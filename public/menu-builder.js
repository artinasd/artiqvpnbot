(function () {
  'use strict';
  if (window.__artiqMenuBuilderLoaded) return;
  window.__artiqMenuBuilderLoaded = true;
  var app = document.getElementById('app');
  if (!app) return;
  var state = { actions: {}, draft: null, published: null, history: [], selectedMenu: 'main' };
  var card, editor, preview, status;
  function el(tag, text, cls) { var node = document.createElement(tag); if (text !== undefined && text !== null) node.textContent = text; if (cls) node.className = cls; return node; }
  function api(action, extra) {
    var options = { headers: { 'Content-Type': 'application/json', 'x-admin-password': window.__artiqCmsPassword || '' } };
    if (action) { options.method = 'POST'; options.body = JSON.stringify(Object.assign({ action: action }, extra || {})); }
    return fetch('/api/menu-builder', options).then(async function (res) { var data = await res.json().catch(function () { return {}; }); if (!res.ok) throw new Error((data.errors || [data.error || 'Request failed']).join(' · ')); return data; });
  }
  function menu() { return state.draft.menus.find(function (item) { return item.id === state.selectedMenu; }) || state.draft.menus[0]; }
  var defaultScreens = {
    service_test: { columns: 1, messageTemplate: '', homeButton: true },
    service_buy: { columns: 1, messageTemplate: '', homeButton: true },
    service_renew: { columns: 1, messageTemplate: '', homeButton: true },
    plans_buy: { columns: 1, messageTemplate: '', customPlanButton: true, customPlanLabel: '🛠 ساخت بسته دلخواه (حجم و زمان)', homeButton: true },
    plans_renew: { columns: 1, messageTemplate: '', homeButton: true },
    account_list: { columns: 1, messageTemplate: '', homeButton: true, detailLabel: '{title}', renewLabel: '🔁', removeLabel: '❌' }
  };
  var screenNames = {
    service_test: 'انتخاب سرویس اکانت تست',
    service_buy: 'انتخاب سرویس برای خرید',
    service_renew: 'انتخاب سرویس برای تمدید',
    plans_buy: 'فهرست پلن‌های خرید',
    plans_renew: 'فهرست پلن‌های تمدید',
    account_list: 'فهرست اشتراک‌های حساب'
  };
  function ensureScreens() {
    if (!state.draft.screens || typeof state.draft.screens !== 'object') state.draft.screens = {};
    Object.keys(defaultScreens).forEach(function (id) {
      state.draft.screens[id] = Object.assign({}, defaultScreens[id], state.draft.screens[id] || {});
    });
  }
  function renderDynamicScreens() {
    ensureScreens();
    var details = el('details', null, 'mb-dynamic-settings');
    var summary = el('summary', 'تنظیمات منوهای پویا (سرویس‌ها، پلن‌ها و اشتراک‌ها)', 'mb-heading');
    details.appendChild(summary);
    details.appendChild(el('p', 'این صفحه‌ها از اطلاعات زنده پنل‌ها، پلن‌ها و حساب کاربر ساخته می‌شوند. متن پیام از جایگزین‌های {service}، {prompt}، {title} و {mode} پشتیبانی می‌کند؛ خالی بگذارید تا متن پیش‌فرض استفاده شود.', 'mb-description'));
    Object.keys(defaultScreens).forEach(function (id) {
      var cfg = state.draft.screens[id];
      var section = el('section', null, 'mb-row');
      section.appendChild(el('strong', screenNames[id], 'mb-screen-title'));
      var controls = el('div', null, 'mb-screen-controls');
      var colWrap = el('label', null, 'mb-field'); colWrap.appendChild(el('span', 'تعداد دکمه در هر ردیف'));
      var colSelect = el('select');
      [1,2,3,4].forEach(function (n) { var opt = el('option', String(n)); opt.value = String(n); opt.selected = Number(cfg.columns || 1) === n; colSelect.appendChild(opt); });
      colSelect.addEventListener('change', function () { cfg.columns = Number(colSelect.value); });
      colWrap.appendChild(colSelect); controls.appendChild(colWrap);
      var msgWrap = el('label', null, 'mb-field'); msgWrap.appendChild(el('span', 'قالب متن پیام'));
      var msg = el('textarea'); msg.rows = 2; msg.value = cfg.messageTemplate || ''; msg.placeholder = '{service}\\n\\n{prompt}'; msg.addEventListener('input', function () { cfg.messageTemplate = msg.value; });
      msgWrap.appendChild(msg); controls.appendChild(msgWrap);
      var homeWrap = el('label', null, 'mb-check-field'); var home = el('input'); home.type = 'checkbox'; home.checked = cfg.homeButton !== false;
      home.addEventListener('change', function () { cfg.homeButton = home.checked; }); homeWrap.appendChild(home); homeWrap.appendChild(el('span', 'نمایش دکمه منوی اصلی')); controls.appendChild(homeWrap);
      if (id === 'plans_buy') {
        var customWrap = el('label', null, 'mb-check-field'); var custom = el('input'); custom.type = 'checkbox'; custom.checked = cfg.customPlanButton !== false;
        custom.addEventListener('change', function () { cfg.customPlanButton = custom.checked; }); customWrap.appendChild(custom); customWrap.appendChild(el('span', 'نمایش دکمه ساخت بسته دلخواه')); controls.appendChild(customWrap);
        var customLabel = field('متن دکمه بسته دلخواه', cfg.customPlanLabel, function (v) { cfg.customPlanLabel = v; }); controls.appendChild(customLabel);
      }
      if (id === 'account_list') {
        controls.appendChild(field('متن دکمه اشتراک (از {title} استفاده کنید)', cfg.detailLabel, function (v) { cfg.detailLabel = v; }));
        controls.appendChild(field('متن دکمه تمدید', cfg.renewLabel, function (v) { cfg.renewLabel = v; }));
        controls.appendChild(field('متن دکمه حذف', cfg.removeLabel, function (v) { cfg.removeLabel = v; }));
      }
      section.appendChild(controls); details.appendChild(section);
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
    state.draft.menus.forEach(function (item) { var opt = el('option', item.name + ' (' + item.id + ')'); opt.value = item.id; opt.selected = item.id === state.selectedMenu; select.appendChild(opt); });
    select.addEventListener('change', function () { state.selectedMenu = select.value; render(); });
    return select;
  }
  function addMenu() {
    var id = 'menu_' + Math.random().toString(36).slice(2, 7);
    state.draft.menus.push({ id: id, name: 'منوی جدید', text: 'لطفاً یکی از گزینه‌ها را انتخاب کنید:', rows: [{ id: 'row_1', buttons: [{ id: 'home', label: '🏠 Main menu', action: 'back_home', params: {} }] }] });
    state.selectedMenu = id; render();
  }
  function render() {
    if (!state.draft) return;
    var selected = menu();
    editor.replaceChildren();
    var top = el('div', null, 'mb-toolbar');
    top.appendChild(el('div', 'ویرایشگر منو', 'mb-heading'));
    top.appendChild(currentMenusSelect());
    top.appendChild(btn('+ Add menu', 'mb-secondary', addMenu));
    if (selected.id !== 'main') top.appendChild(btn('حذف منو', 'mb-danger', function () {
      if (!window.confirm('این منو حذف شود؟ دکمه‌هایی که به آن اشاره می‌کنند نیز باید اصلاح شوند.')) return;
      state.draft.menus = state.draft.menus.filter(function (m) { return m.id !== selected.id; });
      state.draft.menus.forEach(function (m) { m.rows.forEach(function (r) { r.buttons = r.buttons.filter(function (b) { return !(b.action === 'navigate_menu' && b.params.menuId === selected.id); }); }); });
      state.selectedMenu = 'main'; render();
    }));
    editor.appendChild(top);
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
  function renderPreview() {
    if (!preview || !state.draft) return;
    var selected = menu(); preview.replaceChildren();
    preview.appendChild(el('div', 'پیش‌نمایش تلگرام', 'mb-preview-kicker'));
    preview.appendChild(el('div', 'Artiq VPN', 'mb-preview-name'));
    preview.appendChild(el('div', selected.text || 'متن پیام در این قسمت نمایش داده می‌شود.', 'mb-preview-text'));
    var keyboard = el('div', null, 'mb-preview-keyboard');
    selected.rows.forEach(function (row) {
      var line = el('div', null, 'mb-preview-row');
      row.buttons.forEach(function (button) { line.appendChild(el('div', button.label || 'Button', 'mb-preview-button')); });
      keyboard.appendChild(line);
    });
    preview.appendChild(keyboard);
    preview.appendChild(el('div', 'این فقط پیش‌نمایش است؛ ظاهر واقعی دکمه‌ها را تلگرام تعیین می‌کند.', 'mb-preview-note'));
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
      state.actions = data.actions || {}; state.draft = data.draft; ensureScreens(); state.published = data.published; state.history = data.history || [];
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
