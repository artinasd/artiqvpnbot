(function () {
  'use strict';
  function byId(id) { return document.getElementById(id); }
  function api(action, data) {
    return fetch('/api/panels', {
      method: action === 'list' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': window.__artiqCmsPassword || '' },
      body: action === 'list' ? undefined : JSON.stringify({ action: action, ...(data || {}) }),
    }).then(async function (response) {
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(payload.error || 'REQUEST_FAILED');
      return payload;
    });
  }
  function node(tag, text, className) {
    var el = document.createElement(tag);
    if (text != null) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function message(target, text, good) {
    target.replaceChildren(node('div', text, good ? 'ok' : 'error'));
  }
  function renderPanels(container, panels) {
    var list = byId('panel-list');
    list.replaceChildren();
    if (!panels.length) {
      list.appendChild(node('p', 'هنوز پنلی ثبت نشده است.', 'muted'));
      return;
    }
    panels.forEach(function (panel) {
      var card = node('div', null, 'plan');
      var info = node('div');
      info.appendChild(node('div', panel.name + ' · ' + panel.type, 'title'));
      info.appendChild(node('div', panel.baseUrl, 'meta'));
      info.appendChild(node('div', 'وضعیت: ' + panel.status + (panel.hasCredentials ? ' · اطلاعات ورود ذخیره شده' : ' · اطلاعات ورود موجود نیست'), 'meta'));
      var actions = node('div', null, 'actions');
      var test = node('button', 'تست اتصال');
      test.type = 'button';
      test.addEventListener('click', async function () {
        test.disabled = true;
        try {
          var result = await api('test', { id: panel.id });
          message(byId('panel-message'), 'اتصال موفق بود؛ تعداد گروه‌ها: ' + result.connection.groupCount, true);
          await refresh();
        } catch (error) {
          message(byId('panel-message'), 'تست اتصال ناموفق بود: ' + error.message, false);
          await refresh();
        } finally { test.disabled = false; }
      });
      actions.appendChild(test);
      var toggle = node('button', panel.status === 'disabled' ? 'فعال‌سازی مجدد' : 'غیرفعال‌سازی', 'secondary');
      toggle.type = 'button';
      toggle.addEventListener('click', async function () {
        toggle.disabled = true;
        try {
          await api(panel.status === 'disabled' ? 'enable' : 'disable', { id: panel.id });
          await refresh();
          message(byId('panel-message'), 'وضعیت پنل ذخیره شد.', true);
        } catch (error) { message(byId('panel-message'), 'خطا: ' + error.message, false); }
        finally { toggle.disabled = false; }
      });
      actions.appendChild(toggle);
      card.appendChild(info);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }
  async function refresh() {
    var result = await api('list');
    renderPanels(byId('panel-list'), result.panels || []);
  }
  function mount() {
    var app = byId('app');
    if (!app || byId('panels-cms-card') || app.classList.contains('hidden')) return;
    var card = node('section', null, 'card');
    card.id = 'panels-cms-card';
    card.appendChild(node('h3', '🧩 مدیریت پنل‌ها'));
    card.appendChild(node('p', 'هر پنل را جداگانه ثبت کنید. پنل جدید تا زمان موفقیت تست اتصال آماده فروش نیست.', 'muted'));
    var form = node('div', null, 'grid');
    function field(labelText, id, placeholder, type) {
      var wrap = node('div');
      var label = node('label', labelText);
      label.htmlFor = id;
      var input = node('input');
      input.id = id; input.placeholder = placeholder || ''; input.type = type || 'text';
      wrap.appendChild(label); wrap.appendChild(input); form.appendChild(wrap);
      return input;
    }
    field('نام نمایشی', 'panel-name', 'مثلاً Reseller West');
    field('آدرس پنل HTTPS', 'panel-url', 'https://panel.example.com');
    field('نام کاربری مدیر پنل', 'panel-username', 'username');
    field('رمز عبور مدیر پنل', 'panel-password', 'برای پنل جدید یا جایگزینی رمز', 'password');
    var typeWrap = node('div');
    typeWrap.appendChild(node('label', 'نوع پنل'));
    var typeSelect = node('select');
    typeSelect.id = 'panel-type';
    var option = node('option', 'PasarGuard');
    option.value = 'pasarguard';
    typeSelect.appendChild(option); typeWrap.appendChild(typeSelect); form.appendChild(typeWrap);
    card.appendChild(form);
    var actions = node('div', null, 'actions');
    var save = node('button', 'ذخیره پنل');
    save.type = 'button';
    save.addEventListener('click', async function () {
      save.disabled = true;
      try {
        var payload = {
          name: byId('panel-name').value.trim(),
          baseUrl: byId('panel-url').value.trim(),
          type: byId('panel-type').value,
          credentials: { username: byId('panel-username').value.trim(), password: byId('panel-password').value },
        };
        var result = await api('save', { panel: payload });
        byId('panel-password').value = '';
        message(byId('panel-message'), 'پنل ذخیره شد. اکنون «تست اتصال» را بزنید.', true);
        await refresh();
      } catch (error) { message(byId('panel-message'), 'ذخیره ناموفق: ' + error.message, false); }
      finally { save.disabled = false; }
    });
    actions.appendChild(save);
    var reload = node('button', 'بروزرسانی فهرست', 'secondary');
    reload.type = 'button';
    reload.addEventListener('click', function () { refresh().catch(function (e) { message(byId('panel-message'), e.message, false); }); });
    actions.appendChild(reload);
    card.appendChild(actions);
    var status = node('div'); status.id = 'panel-message'; card.appendChild(status);
    card.appendChild(node('h4', 'پنل‌های ثبت‌شده'));
    var list = node('div'); list.id = 'panel-list'; card.appendChild(list);
    app.insertBefore(card, app.firstChild);
    refresh().catch(function (e) { message(status, 'بارگذاری پنل‌ها ناموفق بود: ' + e.message, false); });
  }
  var timer = setInterval(mount, 300);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) mount(); });
}());
