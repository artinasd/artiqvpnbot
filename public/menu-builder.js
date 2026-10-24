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
    state.draft.menus.push({ id: id, name: 'New menu', text: 'Choose an option:', rows: [{ id: 'row_1', buttons: [{ id: 'home', label: '🏠 Main menu', action: 'back_home', params: {} }] }] });
    state.selectedMenu = id; render();
  }
  function render() {
    if (!state.draft) return;
    var selected = menu();
    editor.replaceChildren();
    var top = el('div', null, 'mb-toolbar');
    top.appendChild(el('div', 'Menu editor', 'mb-heading'));
    top.appendChild(currentMenusSelect());
    top.appendChild(btn('+ Add menu', 'mb-secondary', addMenu));
    if (selected.id !== 'main') top.appendChild(btn('Delete menu', 'mb-danger', function () {
      if (!window.confirm('Delete this menu? Buttons pointing to it will need updating.')) return;
      state.draft.menus = state.draft.menus.filter(function (m) { return m.id !== selected.id; });
      state.draft.menus.forEach(function (m) { m.rows.forEach(function (r) { r.buttons = r.buttons.filter(function (b) { return !(b.action === 'navigate_menu' && b.params.menuId === selected.id); }); }); });
      state.selectedMenu = 'main'; render();
    }));
    editor.appendChild(top);
    var basics = el('div', null, 'mb-basics');
    basics.appendChild(field('Menu name', selected.name, function (v) { selected.name = v; }));
    basics.appendChild(field('Menu ID', selected.id, function () {}, 'Set when creating menu'));
    basics.appendChild(field('Message text', selected.text, function (v) { selected.text = v; renderPreview(); }));
    editor.appendChild(basics);
    editor.appendChild(el('div', 'Keyboard layout', 'mb-heading'));
    var rows = el('div', null, 'mb-rows');
    selected.rows.forEach(function (row, rowIndex) {
      var rowCard = el('section', null, 'mb-row');
      var rowHead = el('div', null, 'mb-row-head');
      rowHead.appendChild(el('strong', 'Row ' + (rowIndex + 1)));
      rowHead.appendChild(btn('↑', 'mb-icon-button', function () { if (rowIndex > 0) { var tmp = selected.rows[rowIndex - 1]; selected.rows[rowIndex - 1] = row; selected.rows[rowIndex] = tmp; render(); } }));
      rowHead.appendChild(btn('↓', 'mb-icon-button', function () { if (rowIndex < selected.rows.length - 1) { var tmp = selected.rows[rowIndex + 1]; selected.rows[rowIndex + 1] = row; selected.rows[rowIndex] = tmp; render(); } }));
      rowHead.appendChild(btn('Remove row', 'mb-danger', function () { selected.rows.splice(rowIndex, 1); render(); }));
      rowCard.appendChild(rowHead);
      var buttons = el('div', null, 'mb-button-edit-grid');
      row.buttons.forEach(function (button, buttonIndex) {
        var item = el('div', null, 'mb-button-edit');
        item.appendChild(field('Telegram button label', button.label, function (v) { button.label = v; }));
        var actionLabel = el('label', null, 'mb-field'); actionLabel.appendChild(el('span', 'Button action'));
        var select = actionOptions(button.action); actionLabel.appendChild(select); item.appendChild(actionLabel);
        select.addEventListener('change', function () { button.action = select.value; button.params = {}; render(); });
        if (button.action === 'navigate_menu') {
          var menuField = el('label', null, 'mb-field'); menuField.appendChild(el('span', 'Destination menu'));
          var menuSelect = el('select');
          state.draft.menus.filter(function (m) { return m.id !== selected.id || m.id === button.params.menuId; }).forEach(function (m) { var opt = el('option', m.name + ' (' + m.id + ')'); opt.value = m.id; opt.selected = m.id === button.params.menuId; menuSelect.appendChild(opt); });
          menuSelect.addEventListener('change', function () { button.params.menuId = menuSelect.value; }); menuField.appendChild(menuSelect); item.appendChild(menuField);
        }
        if (button.action === 'open_url') item.appendChild(field('HTTPS URL', button.params.url, function (v) { button.params.url = v; }, 'https://example.com'));
        var controls = el('div', null, 'mb-item-controls');
        controls.appendChild(btn('←', 'mb-icon-button', function () { if (buttonIndex > 0) { row.buttons.splice(buttonIndex, 1); row.buttons.splice(buttonIndex - 1, 0, button); render(); } }));
        controls.appendChild(btn('→', 'mb-icon-button', function () { if (buttonIndex < row.buttons.length - 1) { row.buttons.splice(buttonIndex, 1); row.buttons.splice(buttonIndex + 1, 0, button); render(); } }));
        controls.appendChild(btn('Remove button', 'mb-danger', function () { row.buttons.splice(buttonIndex, 1); render(); }));
        item.appendChild(controls); buttons.appendChild(item);
      });
      rowCard.appendChild(buttons);
      rowCard.appendChild(btn('+ Add button to this row', 'mb-secondary', function () {
        if (row.buttons.length >= 8) return showStatus('Telegram rows support up to 8 buttons here.', false);
        row.buttons.push({ id: 'button_' + Math.random().toString(36).slice(2, 7), label: 'New button', action: 'back_home', params: {} }); render();
      }));
      rows.appendChild(rowCard);
    });
    editor.appendChild(rows);
    editor.appendChild(btn('+ Add row', 'mb-secondary', function () { selected.rows.push({ id: 'row_' + Math.random().toString(36).slice(2, 7), buttons: [] }); render(); }));
    renderPreview();
  }
  function renderPreview() {
    if (!preview || !state.draft) return;
    var selected = menu(); preview.replaceChildren();
    preview.appendChild(el('div', 'TELEGRAM PREVIEW', 'mb-preview-kicker'));
    preview.appendChild(el('div', 'Artiq VPN', 'mb-preview-name'));
    preview.appendChild(el('div', selected.text || 'Message text will appear here.', 'mb-preview-text'));
    var keyboard = el('div', null, 'mb-preview-keyboard');
    selected.rows.forEach(function (row) {
      var line = el('div', null, 'mb-preview-row');
      row.buttons.forEach(function (button) { line.appendChild(el('div', button.label || 'Button', 'mb-preview-button')); });
      keyboard.appendChild(line);
    });
    preview.appendChild(keyboard);
    preview.appendChild(el('div', 'Preview only. Telegram controls actual button styling.', 'mb-preview-note'));
  }
  function showStatus(text, good) { status.replaceChildren(el('div', text, good ? 'mb-ok' : 'mb-error')); }
  function mount() {
    if (document.getElementById('menuBuilderCard')) return;
    card = el('section', null, 'card'); card.id = 'menuBuilderCard';
    card.appendChild(el('h3', '🧩 Visual menu builder'));
    card.appendChild(el('p', 'Build the main menu and submenus, arrange buttons into rows, and assign each button a registered bot action.', 'mb-description'));
    var layout = el('div', null, 'mb-layout');
    editor = el('div', null, 'mb-editor'); preview = el('div', null, 'mb-preview');
    layout.appendChild(editor); layout.appendChild(preview); card.appendChild(layout);
    var actions = el('div', null, 'mb-publish-actions');
    actions.appendChild(btn('Save draft', 'mb-secondary', async function () { try { var result = await api('save_draft', { document: state.draft }); state.draft = result.draft; showStatus('Draft saved. It is not live until published.', true); } catch (e) { showStatus(e.message, false); } }));
    actions.appendChild(btn('Publish to bot', 'mb-button', async function () { if (!window.confirm('Publish this menu configuration to the live bot?')) return; try { await api('save_draft', { document: state.draft }); var result = await api('publish'); state.published = result.published; showStatus('Published version ' + result.published.version + '. The bot will use it for new menu messages.', true); } catch (e) { showStatus(e.message, false); } }));
    var historySelect = el('select'); historySelect.setAttribute('aria-label', 'Previous published version');
    actions.appendChild(historySelect);
    actions.appendChild(btn('Rollback', 'mb-danger', async function () { var version = Number(historySelect.value); if (!version || !window.confirm('Roll back to version ' + version + '?')) return; try { var result = await api('rollback', { version: version }); state.published = result.published; showStatus('Rolled back to version ' + version + '.', true); } catch (e) { showStatus(e.message, false); } }));
    card.appendChild(actions); status = el('div'); card.appendChild(status);
    var login = document.getElementById('login'); if (login && login.parentNode) login.parentNode.insertBefore(card, login.nextSibling);
    api().then(function (data) {
      state.actions = data.actions || {}; state.draft = data.draft; state.published = data.published; state.history = data.history || [];
      historySelect.replaceChildren();
      state.history.forEach(function (item) { var opt = el('option', 'Version ' + item.version + (item.publishedAt ? ' · ' + item.publishedAt : '')); opt.value = item.version; historySelect.appendChild(opt); });
      if (!state.history.length) { var opt = el('option', 'No previous versions'); opt.value = ''; historySelect.appendChild(opt); }
      render();
    }).catch(function (error) { showStatus('Could not load menu settings: ' + error.message, false); });
  }
  var timer = setInterval(function () {
    if (window.__artiqCmsPassword && document.getElementById('app') && !document.getElementById('app').classList.contains('hidden')) { clearInterval(timer); mount(); }
  }, 250);
}());
