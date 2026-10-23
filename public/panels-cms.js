(function () {
  'use strict';
  function byId(id) { return document.getElementById(id); }
  function api(action, data) {
    var endpoint = action === 'list' && data && data.panelId ? '/api/panels?panelId=' + encodeURIComponent(data.panelId) : '/api/panels';
    return fetch(endpoint, {
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
  var selectedPanelId = '';
  var selectedPricingPanelId = '';
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
      var edit = node('button', 'ویرایش', 'secondary');
      edit.type = 'button';
      edit.addEventListener('click', function () {
        byId('panel-id').value = panel.id;
        byId('panel-name').value = panel.name;
        byId('panel-url').value = panel.baseUrl;
        byId('panel-type').value = panel.type;
        byId('panel-username').value = '';
        byId('panel-password').value = '';
        byId('panel-username').placeholder = 'برای حفظ اطلاعات فعلی خالی بگذارید';
        byId('panel-password').placeholder = 'برای حفظ رمز فعلی خالی بگذارید';
        byId('panel-name').focus();
      });
      actions.appendChild(edit);
      var managePlans = node('button', 'مدیریت پلن‌ها', 'secondary');
      managePlans.type = 'button';
      managePlans.addEventListener('click', function () {
        selectedPanelId = panel.id;
        byId('panel-plan-title').textContent = 'پلن‌های پنل: ' + panel.name;
        byId('panel-plan-id').value = '';
        byId('panel-plan-name').value = '';
        byId('panel-plan-price').value = '';
        byId('panel-plan-traffic').value = '10';
        byId('panel-plan-duration').value = '30';
        byId('panel-plan-reseller-price').value = '';
        byId('panel-plan-hwid').value = '0';
        byId('panel-plan-type').value = 'traffic';
        loadPlans(panel.id).catch(function (e) { message(byId('panel-plan-message'), e.message, false); });
        byId('panel-plan-manager').classList.remove('hidden');
        byId('panel-plan-manager').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      actions.appendChild(managePlans);
      var pricingButton = node('button', 'قیمت‌گذاری', 'secondary');
      pricingButton.type = 'button';
      pricingButton.addEventListener('click', function () {
        selectedPricingPanelId = panel.id;
        byId('pricing-panel-title').textContent = 'پنل انتخاب‌شده: ' + panel.name;
        api('list').then(function (result) {
          var pricing = result.config?.pricingByPanel?.[panel.id] || result.config?.pricing || { normalPerGb: 4000, resellerPerGb: null };
          byId('pricing-normal-per-gb').value = pricing.normalPerGb ?? 4000;
          byId('pricing-reseller-per-gb').value = pricing.resellerPerGb == null ? '' : pricing.resellerPerGb;
        }).catch(function (error) { message(byId('panel-pricing-message'), error.message, false); });
        byId('panel-pricing-box').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      actions.appendChild(pricingButton);
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
  async function loadPlans(panelId) {
    var result = await api('list', { panelId: panelId });
    var list = byId('panel-plan-list');
    list.replaceChildren();
    (result.plans || []).forEach(function (plan) {
      var row = node('div', null, 'plan');
      var details = node('div');
      var priceLabel = plan.priceOverride === null || plan.priceOverride === undefined ? 'قیمت خودکار: ' + Number(plan.price).toLocaleString('en-US') : 'قیمت اختصاصی: ' + Number(plan.price).toLocaleString('en-US');
      details.appendChild(node('div', plan.name + ' · ' + priceLabel, 'title'));
      details.appendChild(node('div', 'ID: ' + plan.id + ' · ' + (plan.trafficBytes ? (plan.trafficBytes / (1024 ** 3)) + ' GB' : 'نامحدود') + ' · ' + (plan.durationDays || 'بدون انقضا') + ' روز', 'meta'));
      var actions = node('div', null, 'actions');
      var editPlan = node('button', 'ویرایش', 'secondary'); editPlan.type = 'button';
      editPlan.addEventListener('click', function () {
        byId('panel-plan-id').value = plan.id; byId('panel-plan-name').value = plan.name;
        byId('panel-plan-price').value = plan.priceOverride === null || plan.priceOverride === undefined ? '' : plan.priceOverride; byId('panel-plan-traffic').value = Math.round(Number(plan.trafficBytes || 0) / (1024 ** 3));
        byId('panel-plan-duration').value = plan.durationDays || 0; byId('panel-plan-reseller-price').value = plan.resellerPrice == null ? '' : plan.resellerPrice;
        byId('panel-plan-hwid').value = plan.hwidLimit || 0; byId('panel-plan-type').value = plan.type || 'traffic';
      });
      actions.appendChild(editPlan);
      var disablePlan = node('button', 'غیرفعال‌سازی', 'danger'); disablePlan.type = 'button';
      disablePlan.addEventListener('click', async function () {
        if (!confirm('این پلن از فهرست خرید حذف می‌شود؛ سابقه آن حفظ خواهد شد. ادامه می‌دهید؟')) return;
        try { await api('disable_plan', { id: plan.id, panelId: panelId }); await loadPlans(panelId); message(byId('panel-plan-message'), 'پلن غیرفعال شد.', true); }
        catch (error) { message(byId('panel-plan-message'), error.message, false); }
      });
      actions.appendChild(disablePlan); row.appendChild(details); row.appendChild(actions); list.appendChild(row);
    });
    if (!(result.plans || []).length) list.appendChild(node('p', 'برای این پنل پلنی ثبت نشده است.', 'muted'));
  }
  async function refresh() {
    var result = await api('list');
    renderPanels(byId('panel-list'), result.panels || []);
    if (result.config) {
      var panelPricing = selectedPricingPanelId && result.config.pricingByPanel ? result.config.pricingByPanel[selectedPricingPanelId] : null;
      var pricing = panelPricing || result.config.pricing || { normalPerGb: 4000, resellerPerGb: null };
      byId('pricing-normal-per-gb').value = pricing.normalPerGb ?? 4000;
      byId('pricing-reseller-per-gb').value = pricing.resellerPerGb == null ? '' : pricing.resellerPerGb;
      byId('pricing-panel-title').textContent = selectedPricingPanelId ? 'پنل انتخاب‌شده: ' + (((result.panels || []).find(function (p) { return p.id === selectedPricingPanelId; }) || {}).name || selectedPricingPanelId) : 'ابتدا از کارت پنل، گزینه «قیمت‌گذاری» را انتخاب کنید.';
    }
  }
  function mount() {
    var app = byId('app');
    if (!app || byId('panels-cms-card') || app.classList.contains('hidden')) return;
    var card = node('section', null, 'card');
    card.id = 'panels-cms-card';
    card.appendChild(node('h3', '🧩 مدیریت پنل‌ها'));
    card.appendChild(node('p', 'هر پنل را جداگانه ثبت کنید. پنل جدید تا زمان موفقیت تست اتصال آماده فروش نیست.', 'muted'));
    var pricingBox = node('section', null, 'card');
    pricingBox.id = 'panel-pricing-box';
    pricingBox.appendChild(node('h4', '💰 قیمت‌گذاری پیش‌فرض هر گیگابایت برای هر پنل'));
    pricingBox.appendChild(node('p', 'نرخ‌ها فقط برای پنل انتخاب‌شده اعمال می‌شوند. برای پلن‌های حجمی بدون قیمت اختصاصی استفاده می‌شود؛ قیمت اختصاصی پلن اولویت دارد. پلن نامحدود همچنان به قیمت اختصاصی نیاز دارد.', 'muted'));
    pricingBox.appendChild(node('p', 'ابتدا روی «قیمت‌گذاری» در کارت پنل موردنظر کلیک کنید.', 'muted'));
    var pricingTitle = node('div', 'ابتدا پنلی انتخاب نشده است.', 'title'); pricingTitle.id = 'pricing-panel-title'; pricingBox.appendChild(pricingTitle);
    var pricingGrid = node('div', null, 'grid');
    function pricingField(labelText, id, value, placeholder) {
      var wrap = node('div'); var label = node('label', labelText); label.htmlFor = id;
      var input = node('input'); input.id = id; input.type = 'number'; input.min = '0'; input.value = value; input.placeholder = placeholder || '';
      wrap.appendChild(label); wrap.appendChild(input); pricingGrid.appendChild(wrap); return input;
    }
    pricingField('قیمت هر گیگابایت برای مشتری عادی (تومان)', 'pricing-normal-per-gb', '4000', 'مثلاً 4000');
    pricingField('قیمت هر گیگابایت برای ریسلر (تومان)', 'pricing-reseller-per-gb', '', 'خالی = استفاده از قیمت عادی');
    pricingBox.appendChild(pricingGrid);
    var pricingActions = node('div', null, 'actions');
    var pricingSave = node('button', 'ذخیره نرخ‌ها'); pricingSave.type = 'button';
    pricingSave.addEventListener('click', async function () {
      pricingSave.disabled = true;
      try {
        var normalText = byId('pricing-normal-per-gb').value.trim();
        var resellerText = byId('pricing-reseller-per-gb').value.trim();
        if (normalText === '' || !Number.isFinite(Number(normalText)) || Number(normalText) < 0) throw new Error('INVALID_NORMAL_PRICE_PER_GB');
        if (resellerText !== '' && (!Number.isFinite(Number(resellerText)) || Number(resellerText) < 0)) throw new Error('INVALID_RESELLER_PRICE_PER_GB');
        if (!selectedPricingPanelId) throw new Error('ابتدا پنل موردنظر را انتخاب کنید.');
        await api('save_pricing', { panelId: selectedPricingPanelId, pricing: { normalPerGb: Number(normalText), resellerPerGb: resellerText === '' ? null : Number(resellerText) } });
        message(byId('panel-pricing-message'), 'نرخ‌های پیش‌فرض این پنل ذخیره شد.', true);
      } catch (error) { message(byId('panel-pricing-message'), 'ذخیره نرخ ناموفق: ' + error.message, false); }
      finally { pricingSave.disabled = false; }
    });
    pricingActions.appendChild(pricingSave); pricingBox.appendChild(pricingActions);
    var pricingMessage = node('div'); pricingMessage.id = 'panel-pricing-message'; pricingBox.appendChild(pricingMessage);
    card.appendChild(pricingBox);
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
    field('شناسه داخلی (فقط برای ویرایش)', 'panel-id', 'برای پنل جدید خالی بگذارید').readOnly = true;
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
          id: byId('panel-id').value.trim() || undefined,
          name: byId('panel-name').value.trim(),
          baseUrl: byId('panel-url').value.trim(),
          type: byId('panel-type').value,
          credentials: (byId('panel-username').value.trim() && byId('panel-password').value) ? { username: byId('panel-username').value.trim(), password: byId('panel-password').value } : undefined,
        };
        var result = await api('save', { panel: payload });
        byId('panel-password').value = '';
        byId('panel-username').value = '';
        byId('panel-id').value = '';
        byId('panel-username').placeholder = 'username';
        byId('panel-password').placeholder = 'برای پنل جدید یا جایگزینی رمز';
        // Saving a panel is followed by a fresh connection test. Until that succeeds,
        // status stays pending and the panel is not selectable for new sales.
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
    var planManager = node('section', null, 'card hidden');
    planManager.id = 'panel-plan-manager';
    var planTitle = node('h3', 'پلن‌های پنل'); planTitle.id = 'panel-plan-title'; planManager.appendChild(planTitle);
    planManager.appendChild(node('p', 'شناسه پلن باید یکتا باشد؛ نام پلن‌ها بین پنل‌های مختلف می‌تواند یکسان باشد.', 'muted'));
    var planForm = node('div', null, 'grid');
    function planField(labelText, id, placeholder, type) {
      var wrap = node('div'); var label = node('label', labelText); label.htmlFor = id;
      var input = node('input'); input.id = id; input.placeholder = placeholder || ''; input.type = type || 'text';
      wrap.appendChild(label); wrap.appendChild(input); planForm.appendChild(wrap); return input;
    }
    planField('شناسه پلن', 'panel-plan-id', 'مثلاً west_10g');
    planField('نام پلن', 'panel-plan-name', 'مثلاً 10 GB / 30 days');
    planField('قیمت', 'panel-plan-price', 'قیمت به تومان', 'number');
    planField('حجم گیگابایت (۰ = نامحدود)', 'panel-plan-traffic', '10', 'number');
    planField('مدت روز (۰ = بدون انقضا)', 'panel-plan-duration', '30', 'number');
    planField('قیمت ریسلر (اختیاری)', 'panel-plan-reseller-price', 'خالی = قیمت اصلی', 'number');
    planField('محدودیت دستگاه', 'panel-plan-hwid', '0', 'number');
    var planTypeWrap = node('div'); planTypeWrap.appendChild(node('label', 'نوع پلن'));
    var planType = node('select'); planType.id = 'panel-plan-type';
    [['traffic','حجمی'],['unlimited','نامحدود']].forEach(function (entry) { var opt = node('option', entry[1]); opt.value = entry[0]; planType.appendChild(opt); });
    planTypeWrap.appendChild(planType); planForm.appendChild(planTypeWrap);
    planManager.appendChild(planForm);
    var planActions = node('div', null, 'actions'); var planSave = node('button', 'ذخیره پلن'); planSave.type = 'button';
    planSave.addEventListener('click', async function () {
      if (!selectedPanelId) return;
      planSave.disabled = true;
      try {
        var trafficGb = Number(byId('panel-plan-traffic').value || 0);
        var days = Number(byId('panel-plan-duration').value || 0);
        var resellerText = byId('panel-plan-reseller-price').value.trim();
        var priceText = byId('panel-plan-price').value.trim();
        var plan = {
          id: byId('panel-plan-id').value.trim(), name: byId('panel-plan-name').value.trim(),
          buttonText: byId('panel-plan-name').value.trim(), price: priceText === '' ? null : Number(priceText),
          resellerPrice: resellerText === '' ? null : Number(resellerText), service: 'tunnel',
          type: byId('panel-plan-type').value, trafficBytes: trafficGb * (1024 ** 3),
          durationDays: days === 0 ? null : days, hwidLimit: Number(byId('panel-plan-hwid').value || 0),
          active: true, testEnabled: true,
        };
        await api('save_plan', { panelId: selectedPanelId, plan: plan });
        message(byId('panel-plan-message'), 'پلن ذخیره شد.', true);
        byId('panel-plan-id').value = '';
        await loadPlans(selectedPanelId);
      } catch (error) { message(byId('panel-plan-message'), 'ذخیره پلن ناموفق: ' + error.message, false); }
      finally { planSave.disabled = false; }
    });
    planActions.appendChild(planSave);
    var planClose = node('button', 'بستن', 'secondary'); planClose.type = 'button';
    planClose.addEventListener('click', function () { planManager.classList.add('hidden'); }); planActions.appendChild(planClose);
    planManager.appendChild(planActions);
    var planMsg = node('div'); planMsg.id = 'panel-plan-message'; planManager.appendChild(planMsg);
    var planList = node('div'); planList.id = 'panel-plan-list'; planManager.appendChild(planList);
    card.appendChild(planManager);
    app.insertBefore(card, app.firstChild);
    refresh().catch(function (e) { message(status, 'بارگذاری پنل‌ها ناموفق بود: ' + e.message, false); });
  }
  var timer = setInterval(mount, 300);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) mount(); });
}());
