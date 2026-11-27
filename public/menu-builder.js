(function () {
  'use strict';
  if (window.__artiqMenuBuilderLoaded) return;
  window.__artiqMenuBuilderLoaded = true;
  var app = document.getElementById('app');
  if (!app) return;
  var state = { actions: {}, draft: null, published: null, history: [], botTexts: {}, systemMessageDefaults: {}, botButtons: {}, supportUsername: '', plans: [], panels: [], selectedMenu: 'main', editorMode: 'menu', selectedScreen: 'service_test', previewScreen: 'menu' };
  var card, editor, preview, status;
  function el(tag, text, cls) { var node = document.createElement(tag); if (text !== undefined && text !== null) node.textContent = text; if (cls) node.className = cls; return node; }
  function api(action, extra) {
    var options = { headers: { 'Content-Type': 'application/json', 'x-admin-password': window.__artiqCmsPassword || '' } };
    if (action) { options.method = 'POST'; options.body = JSON.stringify(Object.assign({ action: action }, extra || {})); }
    return fetch('/api/menu-builder', options).then(async function (res) { var data = await res.json().catch(function () { return {}; }); if (!res.ok) throw new Error((data.errors || [data.error || 'Request failed']).join(' · ')); return data; });
  }
  function menu() { return state.draft.menus.find(function (item) { return item.id === state.selectedMenu; }) || state.draft.menus[0]; }
  var defaultScreens = {
    service_test: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'glass', buttonControls: {} },
    service_buy: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'glass', buttonControls: {} },
    service_renew: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'glass', buttonControls: {} },
    plans_buy: { columns: 1, messageTemplate: '', customPlanButton: true, customPlanLabel: '🛠 ساخت بسته دلخواه (حجم و زمان)', customPlanByService: {}, homeButton: true, buttonStyle: 'glass', buttonControls: {} },
    plans_renew: { columns: 1, messageTemplate: '', homeButton: true, buttonStyle: 'glass', buttonControls: {} },
    account_list: { columns: 3, messageTemplate: '', homeButton: true, detailLabel: '{title}', renewLabel: '🔁', removeLabel: '❌', buttonControls: {} },
    account_detail: { columns: 2, messageTemplate: '', openLabel: '🔗 باز کردن لینک', copyLabel: '📋 کپی لینک', renewLabel: '🔄 تمدید اشتراک', backLabel: '⬅️ بازگشت به اشتراک‌ها', homeButton: true, buttonControls: {} },
    account_remove: { columns: 2, messageTemplate: '', confirmLabel: '🗑️ بله، حذف اشتراک', cancelLabel: '↩️ انصراف', buttonControls: {} },
    wallet: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {} },
    support: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {} },
    subscription_name: { columns: 1, messageTemplate: '', homeButton: false, buttonControls: {} },
    wallet_checkout: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {} },
    wallet_topup: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {} },
    subscription_delivery: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {} },
    renewal_delivery: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {} },
    copy_sub: { columns: 1, messageTemplate: '', homeButton: false, buttonControls: {} },
    account_empty: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {} },
    custom_traffic: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {} },
    custom_duration: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {} },
    force_join: { columns: 1, messageTemplate: '', homeButton: true, buttonControls: {} }
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
    support: 'صفحه پشتیبانی',
    subscription_name: 'درخواست نام اشتراک',
    wallet_checkout: 'کسری موجودی و شارژ کیف پول',
    wallet_topup: 'صفحه کارت‌به‌کارت و ارسال رسید',
    subscription_delivery: 'پیام تحویل اشتراک جدید',
    renewal_delivery: 'پیام تحویل تمدید اشتراک',
    copy_sub: 'صفحه کپی لینک اشتراک',
    account_empty: 'حساب من (بدون اشتراک)',
    custom_traffic: 'بسته دلخواه: ورود حجم',
    custom_duration: 'بسته دلخواه: ورود مدت',
    force_join: 'پیام عضویت اجباری'
  };
  function appendNavigationTargets(select, selectedId) {
    var menuGroup = el('optgroup'); menuGroup.label = 'منوهای سفارشی';
    state.draft.menus.forEach(function (m) {
      var opt = el('option', m.name + ' (' + m.id + ')'); opt.value = m.id; opt.selected = m.id === selectedId; menuGroup.appendChild(opt);
    });
    select.appendChild(menuGroup);
    var screenGroup = el('optgroup'); screenGroup.label = 'صفحه‌های داخلی ربات';
    Object.keys(screenNames).forEach(function (id) {
      var opt = el('option', screenNames[id]); opt.value = 'screen_' + id; opt.selected = opt.value === selectedId; screenGroup.appendChild(opt);
    });
    select.appendChild(screenGroup);
  }
  function ensureScreens() {
    if (!state.draft.screens || typeof state.draft.screens !== 'object') state.draft.screens = {};
    Object.keys(defaultScreens).forEach(function (id) {
      // Keep each screen config object stable. Inputs hold a reference to this
      // object; replacing it on every preview render detaches them after the
      // first keystroke and causes the preview/save draft to retain stale text.
      if (!state.draft.screens[id] || typeof state.draft.screens[id] !== 'object') {
        state.draft.screens[id] = Object.assign({}, defaultScreens[id]);
      } else {
        Object.keys(defaultScreens[id]).forEach(function (key) {
          if (typeof state.draft.screens[id][key] === 'undefined') {
            state.draft.screens[id][key] = defaultScreens[id][key];
          }
        });
      }
      var cfg = state.draft.screens[id];
      var legacyDefaultStyle = { service_test: 'success', service_buy: 'primary', service_renew: 'success', plans_buy: 'primary', plans_renew: 'success' }[id];
      if (legacyDefaultStyle && cfg.buttonStyle === legacyDefaultStyle) cfg.buttonStyle = 'glass';
      if (cfg.buttonControls && typeof cfg.buttonControls === 'object') Object.keys(cfg.buttonControls).forEach(function (role) { if (cfg.buttonControls[role] && cfg.buttonControls[role].style === 'default') cfg.buttonControls[role].style = 'glass'; });
      if (!Array.isArray(cfg.buttons)) cfg.buttons = [];
    });
  }
  function panelActionField(action, params, onChange) {
    var isTest = action === 'select_panel_test';
    var candidates = state.panels.filter(function (panel) {
      return isTest ? panel.testEnabled !== false : panel.purchaseEnabled !== false;
    });
    var wrap = el('label', null, 'mb-field');
    wrap.appendChild(el('span', isTest ? 'پنل مقصد برای اکانت تست' : 'پنل مقصد برای خرید'));
    var select = el('select');
    var selectedId = String(params.serviceId || '');
    if (selectedId && !candidates.some(function (panel) { return String(panel.id) === selectedId; })) {
      var stale = el('option', 'پنل انتخاب‌شده در دسترس نیست (' + selectedId + ')');
      stale.value = selectedId; stale.selected = true; stale.disabled = true; select.appendChild(stale);
    }
    if (!candidates.length) {
      if (!selectedId) { var empty = el('option', 'پنل فعالی برای این عملیات وجود ندارد'); empty.value = ''; empty.disabled = true; empty.selected = true; select.appendChild(empty); }
      select.disabled = true;
    } else {
      candidates.forEach(function (panel) {
        var option = el('option', panel.name);
        option.value = String(panel.id);
        option.selected = option.value === selectedId;
        select.appendChild(option);
      });
      if (!selectedId) {
        selectedId = String(candidates[0].id);
        params.serviceId = selectedId;
      }
      select.value = selectedId;
    }
    select.addEventListener('change', function () { onChange(select.value); });
    wrap.appendChild(select);
    return wrap;
  }
  function renderManagedButton(button, options) {
    options = options || {};
    if (!button.params || typeof button.params !== 'object') button.params = {};
    var item = el('div', null, 'mb-button-edit');
    item.appendChild(field(options.label || 'متن دکمه در تلگرام', button.label, function (v) { button.label = v; }));
    var actionLabel = el('label', null, 'mb-field'); actionLabel.appendChild(el('span', 'عملکرد دکمه'));
    var select = actionOptions(button.action); actionLabel.appendChild(select); item.appendChild(actionLabel);
    select.addEventListener('change', function () { button.action = select.value; button.params = {}; render(); });
    var styleLabel = el('label', null, 'mb-field'); styleLabel.appendChild(el('span', 'رنگ دکمه در تلگرام'));
    var styleSelect = el('select');
    [['glass','شیشه ای'],['primary','آبی'],['success','سبز'],['danger','قرمز']].forEach(function (entry) {
      var opt = el('option', entry[1]); opt.value = entry[0]; opt.selected = (button.style || 'glass') === entry[0]; styleSelect.appendChild(opt);
    });
    styleSelect.addEventListener('change', function () { button.style = styleSelect.value; renderPreview(); });
    styleLabel.appendChild(styleSelect); item.appendChild(styleLabel);
    if (button.action === 'navigate_menu') {
      var menuField = el('label', null, 'mb-field'); menuField.appendChild(el('span', 'منوی مقصد'));
      var menuSelect = el('select');
      appendNavigationTargets(menuSelect, button.params.menuId);
      // A native select visually chooses its first option by default, but that does not fire change; persist that ID immediately.
      if (!button.params.menuId && menuSelect.options.length) button.params.menuId = menuSelect.value;
      menuSelect.addEventListener('change', function () { button.params.menuId = menuSelect.value; });
      menuField.appendChild(menuSelect); item.appendChild(menuField);
    }
    if (button.action === 'open_url') item.appendChild(field('لینک HTTPS', button.params.url, function (v) { button.params.url = v; }, 'https://example.com'));
    if (button.action === 'select_panel_buy' || button.action === 'select_panel_test') {
      item.appendChild(panelActionField(button.action, button.params, function (serviceId) { button.params.serviceId = serviceId; }));
    }
    return item;
  }
  function renderScreenButtons(screenId, cfg) {
    var wrap = el('section', null, 'mb-row');
    wrap.appendChild(el('strong', 'دکمه‌های اضافی این منو', 'mb-screen-title'));
    wrap.appendChild(el('p', 'این دکمه‌ها کنار دکمه‌های زندهٔ سرویس/پلن/اشتراک نمایش داده می‌شوند. هر ردیف می‌تواند چند دکمه داشته باشد؛ چیدمان ردیف‌ها برای دکمه‌های موجود و جدید قابل تنظیم است.', 'mb-description'));
    if (!Array.isArray(cfg.buttons)) cfg.buttons = [];
    function getRows() {
      var groups = [];
      cfg.buttons.forEach(function (button, index) {
        if (!button.params || typeof button.params !== 'object') button.params = {};
        var key = button.rowId || ('legacy:' + (button.id || index));
        var group = groups.find(function (item) { return item.key === key; });
        if (!group) { group = { key: key, buttons: [] }; groups.push(group); }
        group.buttons.push(button);
      });
      return groups;
    }
    var rows = el('div', null, 'mb-rows');
    getRows().forEach(function (group, rowIndex) {
      var rowCard = el('section', null, 'mb-row');
      var rowHead = el('div', null, 'mb-row-head');
      rowHead.appendChild(el('strong', 'ردیف ' + (rowIndex + 1)));
      rowCard.appendChild(rowHead);
      var grid = el('div', null, 'mb-button-edit-grid');
      group.buttons.forEach(function (button, buttonIndex) {
        var item = renderManagedButton(button);
        var controls = el('div', null, 'mb-item-controls');
        controls.appendChild(btn('←', 'mb-icon-button', function () {
          if (buttonIndex > 0) {
            var previous = group.buttons[buttonIndex - 1];
            var a = cfg.buttons.indexOf(button), b = cfg.buttons.indexOf(previous);
            cfg.buttons[a] = previous; cfg.buttons[b] = button; render();
          }
        }));
        controls.appendChild(btn('→', 'mb-icon-button', function () {
          if (buttonIndex < group.buttons.length - 1) {
            var next = group.buttons[buttonIndex + 1];
            var a = cfg.buttons.indexOf(button), b = cfg.buttons.indexOf(next);
            cfg.buttons[a] = next; cfg.buttons[b] = button; render();
          }
        }));
        controls.appendChild(btn('حذف دکمه', 'mb-danger', function () { cfg.buttons.splice(cfg.buttons.indexOf(button), 1); render(); }));
        item.appendChild(controls); grid.appendChild(item);
      });
      rowCard.appendChild(grid);
      rowCard.appendChild(btn('+ افزودن دکمه به این ردیف', 'mb-secondary', function () {
        if (cfg.buttons.length >= 20) return showStatus('برای هر منو حداکثر ۲۰ دکمهٔ اضافی مجاز است.', false);
        var rowId = group.key.indexOf('legacy:') === 0 ? 'screen_row_' + Math.random().toString(36).slice(2, 7) : group.key;
        group.buttons.forEach(function (button) { button.rowId = rowId; });
        cfg.buttons.push({ id: 'screen_button_' + Math.random().toString(36).slice(2, 7), rowId: rowId, label: 'دکمه جدید', action: 'back_home', params: {} });
        render();
      }));
      rows.appendChild(rowCard);
    });
    wrap.appendChild(rows);
    wrap.appendChild(btn('+ افزودن ردیف', 'mb-secondary', function () {
      if (cfg.buttons.length >= 20) return showStatus('برای هر منو حداکثر ۲۰ دکمهٔ اضافی مجاز است.', false);
      cfg.buttons.push({ id: 'screen_button_' + Math.random().toString(36).slice(2, 7), rowId: 'screen_row_' + Math.random().toString(36).slice(2, 7), label: 'دکمه جدید', action: 'back_home', params: {} }); render();
    }));
    return wrap;
  }
  function defaultScreenMessageTemplate(id) {
    var botTexts = state.botTexts || {};
    var sysMsgs = (state.draft && state.draft.systemMessages) || {};
    var txt = function (k, fb) { return sysMsgs[k] || botTexts[k] || fb; };
    var defaults = {
      service_test: txt('serviceSelectionTest', '🎁 سرویس مورد نظر برای اکانت تست را انتخاب کنید:'),
      service_buy: txt('serviceSelectionBuy', '🛒 ابتدا سرویس مورد نظر را انتخاب کنید:'),
      service_renew: txt('serviceSelectionRenew', '🔄 سرویس مورد نظر برای تمدید را انتخاب کنید:'),
      plans_buy: '{service}\n\n' + txt('planPrompt', 'لطفاً بسته مورد نظر را انتخاب کنید:'),
      plans_renew: '{service}\n\n' + txt('planPrompt', 'لطفاً بسته مورد نظر را انتخاب کنید:'),
      account_list: '👤 <b>حساب من</b>\n\nاشتراک موردنظر را انتخاب کنید:',
      account_detail: '📦 پلن نمونه\nسرویس: سرویس اصلی\nوضعیت: ✅ فعال\nترافیک: ۱۰ گیگابایت\nمدت: ۳۰ روز',
      account_remove: '⚠️ حذف اشتراک {title}\n\nاین کار کاربر را از پنل PasarGuard حذف می‌کند و اشتراک را از فهرست حساب شما پنهان می‌کند. سابقه سفارش و پرداخت برای سوابق مالی حفظ می‌شود.\n\nآیا مطمئن هستید؟',
      wallet: '💰 <b>کیف پول من</b>\n\nموجودی فعلی: <b>{balance} تومان</b>\n\nمبلغی که می‌خواهید کیف پول را شارژ کنید به تومان وارد کنید.\n\nپس از ارسال رسید و تأیید مدیر، مبلغ به موجودی شما اضافه می‌شود.',
      support: txt('support', 'ℹ️ برای پشتیبانی و راهنمایی، با ما در ارتباط باشید:\n\n💬 @{support_username}'),
      subscription_name: txt('subscriptionNamePrompt', '👤 نام اشتراک\n\nاگر می‌خواهید نام دلخواهی برای اشتراک خود انتخاب کنید، آن را وارد کنید؛ در غیر این صورت نام به صورت خودکار ساخته می‌شود.'),
      wallet_checkout: '💰 <b>موجودی کیف پول</b>\n\nموجودی فعلی: <b>{balance} تومان</b>\nقیمت این اشتراک: <b>{price} تومان</b>\nکسری: <b>{missing} تومان</b>\n\nبرای ادامه، کیف پول خود را حداقل به اندازه مبلغ اشتراک شارژ کنید.\n\nمبلغ شارژ را به تومان وارد کنید:',
      wallet_topup: '💳 <b>شارژ کیف پول</b>\n\n💰 مبلغ: <b>{amount} تومان</b>\n\n🏦 <b>شماره کارت</b>\n<code>{card}</code>\n👤 <b>به نام:</b> {holder}\n\nرسید پرداخت را همین‌جا ارسال کنید.',
      subscription_delivery: txt('subscriptionSuccess', '🎉 <b>اشتراک شما با موفقیت ساخته شد!</b>\n\n📦 <b>سرویس:</b> {plan_name}\n👤 <b>نام اشتراک:</b> <code>{username}</code>\n\n🔗 <code>{sub_url}</code>'),
      renewal_delivery: txt('renewalSuccess', '🎉 <b>اشتراک شما تمدید شد!</b>\n\n📦 <b>سرویس:</b> {plan_name}\n👤 <b>نام اشتراک:</b> <code>{username}</code>\n⏳ <b>اعتبار جدید:</b> {expire}\n\n🔗 <code>{sub_url}</code>'),
      copy_sub: '📋 لینک اشتراک:',
      account_empty: txt('accountNoSubscription', '👤 هنوز اشتراک فعالی برای حساب شما ثبت نشده است.'),
      custom_traffic: '🛠 حجم مورد نیاز را به گیگابایت وارد کنید.\nحداقل: {min_traffic} | حداکثر: {max_traffic} گیگابایت',
      custom_duration: '✅ حجم {traffic} گیگابایت ثبت شد.\n💳 قیمت: {price} تومان\n\nمدت را به صورت «۳۰ روزه» یا «۱ ماهه» وارد کنید. حداکثر {max_days} روز.',
      force_join: '🔒 برای استفاده از ربات، ابتدا در کانال(های) ما عضو شوید. سپس روی «بررسی عضویت» بزنید.'
    };
    return Object.prototype.hasOwnProperty.call(defaults, id) ? String(defaults[id] == null ? '' : defaults[id]) : '';
  }
  function renderDynamicScreens(selectedScreen) {
    ensureScreens();
    var details = el('details', null, 'mb-dynamic-settings');
    if (selectedScreen) details.open = true;
    var summary = el('summary', selectedScreen ? 'تنظیمات منوی انتخاب‌شده' : 'تنظیمات منوهای پویا (سرویس‌ها، پلن‌ها و اشتراک‌ها)', 'mb-heading');
    details.appendChild(summary);
    details.appendChild(el('p', 'این صفحه‌ها از اطلاعات زنده پنل‌ها، پلن‌ها و حساب کاربر ساخته می‌شوند. متن پیام را مثل منوی اصلی در ورودی ساده ویرایش کنید؛ دکمه‌های موجود و اضافی را در بخش‌های زیر مدیریت کنید. متن پیام از {service}، {prompt}، {title} و {mode} پشتیبانی می‌کند.', 'mb-description'));
    Object.keys(defaultScreens).filter(function (id) { return !selectedScreen || id === selectedScreen; }).forEach(function (id) {
      var cfg = state.draft.screens[id];
      var section = el('section', null, 'mb-row');
      section.appendChild(el('strong', screenNames[id], 'mb-screen-title'));
      // Use the same simple, persistent message input as the main menu.
      // The extra columns/style/template controls were redundant and confusing.
      section.appendChild(field('متن پیام', cfg.messageTemplate != null && String(cfg.messageTemplate) !== '' ? String(cfg.messageTemplate) : defaultScreenMessageTemplate(id), function (v) { cfg.messageTemplate = v; state.previewScreen = id; }));
      if (id === 'wallet') section.appendChild(el('small', 'متغیر موجودی فعلی: {balance} (نمونه در پیش‌نمایش: ۱۲۵,۰۰۰)', 'mb-help'));
      if (id === 'plans_buy') {
        if (!cfg.customPlanByService || typeof cfg.customPlanByService !== 'object') cfg.customPlanByService = {};
        section.appendChild(el('strong', 'تنظیم ساخت بسته دلخواه برای هر سرویس', 'mb-screen-title'));
        section.appendChild(el('small', 'مقدار خالیِ حداکثر مدت، رفتار فعلی خودکار (۶۰ یا ۱۵۰ روز) را حفظ می‌کند.', 'mb-help'));
        state.panels.filter(function(panel){return panel.purchaseEnabled !== false;}).forEach(function(panel){
          var serviceId = String(panel.id);
          var setting = cfg.customPlanByService[serviceId] || (cfg.customPlanByService[serviceId] = {});
          var card = el('div', null, 'mb-button-edit');
          card.appendChild(el('strong', panel.name, 'mb-screen-title'));
          var enabledLabel = el('label', null, 'mb-field');
          var enabled = el('input'); enabled.type = 'checkbox'; enabled.checked = setting.enabled !== false;
          enabled.addEventListener('change', function(){setting.enabled = enabled.checked; renderPreview();});
          enabledLabel.appendChild(enabled); enabledLabel.appendChild(el('span', 'نمایش دکمه ساخت بسته دلخواه برای این سرویس'));
          card.appendChild(enabledLabel);
          function numericSetting(label, key, fallback, max, optional){
            var wrap = el('label', null, 'mb-field'); wrap.appendChild(el('span', label));
            var input = el('input'); input.type = 'number'; input.min = '1'; input.max = String(max); input.step = '1';
            input.value = setting[key] == null ? (optional ? '' : String(fallback)) : String(setting[key]);
            input.placeholder = optional ? 'خودکار' : String(fallback);
            input.addEventListener('input', function(){ setting[key] = optional && input.value.trim() === '' ? null : Number(input.value); });
            wrap.appendChild(input); return wrap;
          }
          card.appendChild(numericSetting('حداقل حجم (گیگابایت)', 'minTrafficGb', 1, 1000, false));
          card.appendChild(numericSetting('حداکثر حجم (گیگابایت)', 'maxTrafficGb', 1000, 1000, false));
          card.appendChild(numericSetting('حداکثر مدت (روز) — خالی = رفتار فعلی', 'maxDays', null, 150, true));
          section.appendChild(card);
        });
      }
      var managedRoleGroups = {
        service_test: state.panels.filter(function(panel){return panel.testEnabled !== false;}).map(function(panel){return {id:panel.id,label:panel.name,panelButton:true};}).concat([{id:'home',label:'منوی اصلی'}]),
        service_buy: state.panels.filter(function(panel){return panel.purchaseEnabled !== false;}).map(function(panel){return {id:panel.id,label:panel.name,panelButton:true};}).concat([{id:'home',label:'منوی اصلی'}]),
        service_renew: state.panels.filter(function(panel){return panel.purchaseEnabled !== false;}).map(function(panel){return {id:panel.id,label:panel.name,panelButton:true};}).concat([{id:'home',label:'منوی اصلی'}]),
        plans_buy: [{id:'plans',label:'پلن‌های خرید'},{id:'custom_plan',label:'ساخت بسته دلخواه'},{id:'home',label:'منوی اصلی'}],
        plans_renew: [{id:'plans',label:'پلن‌های تمدید'},{id:'home',label:'منوی اصلی'}],
        account_list: [{id:'subscription_detail',label:'باز کردن جزئیات اشتراک'},{id:'subscription_renew',label:'تمدید اشتراک'},{id:'subscription_remove',label:'حذف اشتراک'},{id:'home',label:'منوی اصلی'}],
        account_detail: [{id:'open_link',label:'باز کردن لینک اشتراک'},{id:'copy_link',label:'کپی لینک اشتراک'},{id:'renew_subscription',label:'تمدید اشتراک'},{id:'back_to_list',label:'بازگشت به فهرست'},{id:'home',label:'منوی اصلی'}],
        account_remove: [{id:'confirm_remove',label:'تأیید حذف'},{id:'cancel_remove',label:'انصراف از حذف'}],
        wallet: [{id:'home',label:'منوی اصلی'}],
        support: [{id:'home',label:'منوی اصلی'}],
        subscription_name: [{id:'auto_name',label:'نام خودکار'},{id:'home',label:'منوی اصلی'}],
        wallet_checkout: [{id:'charge',label:'شارژ کیف پول'},{id:'home',label:'منوی اصلی'}],
        wallet_topup: [{id:'copy_card',label:'کپی شماره کارت'},{id:'home',label:'منوی اصلی'}],
        subscription_delivery: [{id:'copy_sub',label:'کپی لینک اشتراک'},{id:'open_sub',label:'باز کردن لینک اشتراک'},{id:'home',label:'منوی اصلی'}],
        renewal_delivery: [{id:'copy_sub',label:'کپی لینک اشتراک'},{id:'open_sub',label:'باز کردن لینک اشتراک'},{id:'home',label:'منوی اصلی'}],
        copy_sub: [{id:'copy_link',label:'کپی لینک اشتراک'},{id:'back_to_detail',label:'بازگشت به اشتراک'}],
        account_empty: [{id:'home',label:'منوی اصلی'}],
        custom_traffic: [{id:'home',label:'منوی اصلی'}],
        custom_duration: [{id:'home',label:'منوی اصلی'}],
        force_join: [{id:'join_channel',label:'عضویت در کانال'},{id:'check_join',label:'بررسی عضویت'},{id:'home',label:'منوی اصلی'}]
      };
      var roleDefs = managedRoleGroups[id] || [];
      if (roleDefs.length) {
        if (!cfg.buttonControls || typeof cfg.buttonControls !== 'object') cfg.buttonControls = {};
        if (['service_test','service_buy','service_renew'].includes(id) && Array.isArray(cfg.buttonRows) && cfg.buttonRows.some(function(row){return (row.roles||[]).includes('services');})) {
          var panelRoles = roleDefs.filter(function(role){return role.panelButton;});
          var legacyControl = cfg.buttonControls.services || {};
          if (panelRoles.length) {
            var migratedRows = [];
            cfg.buttonRows.forEach(function(row){
              var roles = Array.isArray(row.roles) ? row.roles.slice() : [];
              if (!roles.includes('services')) { migratedRows.push(row); return; }
              roles = roles.filter(function(role){return role !== 'services';});
              var homeRoles = roles.filter(function(role){return role === 'home';});
              var firstPanel = panelRoles.shift();
              if (firstPanel) migratedRows.push(Object.assign({},row,{roles:[firstPanel.id]}));
              panelRoles.forEach(function(role){migratedRows.push({id:'managed_row_'+role.id,roles:[role.id]});});
              panelRoles = [];
              if (homeRoles.length) migratedRows.push({id:'managed_row_home',roles:homeRoles});
            });
            cfg.buttonRows = migratedRows;
          }
          roleDefs.filter(function(role){return role.panelButton;}).forEach(function(role){ if(!cfg.buttonControls[role.id]) cfg.buttonControls[role.id]={enabled:legacyControl.enabled !== false,style:legacyControl.style || 'glass',action:'original',params:{}}; });
        }
        if (!Array.isArray(cfg.buttonRows)) {
          cfg.buttonRows = [];
          roleDefs.forEach(function (role) {
            var existing = cfg.buttonControls[role.id];
            if (existing && existing.enabled === false) return;
            if (role.id === 'home' && cfg.homeButton === false) return;
            cfg.buttonRows.push({ id: 'managed_row_' + role.id, roles: [role.id] });
          });
          if (id === 'account_list') {
            cfg.buttonRows = [
              { id:'managed_row_subscription', roles:['subscription_detail'] },
              { id:'managed_row_subscription_actions', roles:['subscription_renew','subscription_remove'] },
              { id:'managed_row_home', roles:['home'] }
            ].map(function (row) { row.roles = row.roles.filter(function (roleId) { return roleDefs.some(function (role) { return role.id === roleId; }) && !(cfg.buttonControls[roleId] && cfg.buttonControls[roleId].enabled === false) && !(roleId === 'home' && cfg.homeButton === false); }); return row; }).filter(function (row) { return row.roles.length > 0; });
          }
          if (id === 'account_detail' && cfg.buttonRows.length) {
            cfg.buttonRows = [
              { id:'managed_row_links', roles:['open_link','copy_link'] },
              { id:'managed_row_renew', roles:['renew_subscription'] },
              { id:'managed_row_back', roles:['back_to_list'] },
              { id:'managed_row_home', roles:['home'] }
            ].map(function (row) { row.roles = row.roles.filter(function (roleId) { return roleDefs.some(function (role) { return role.id === roleId; }) && !(cfg.buttonControls[roleId] && cfg.buttonControls[roleId].enabled === false) && !(roleId === 'home' && cfg.homeButton === false); }); return row; }).filter(function (row) { return row.roles.length > 0; });
          }
        }
        // A panel can be added after this screen's button rows were first saved.
        // Reconcile only genuinely new service IDs so they appear in the editor,
        // while respecting an existing control/row removal as an intentional choice.
        if (id === 'service_test' || id === 'service_buy') {
          roleDefs.filter(function (role) { return role.panelButton; }).forEach(function (role) {
            if (Object.prototype.hasOwnProperty.call(cfg.buttonControls, role.id)) return;
            cfg.buttonControls[role.id] = { enabled: true, style: 'glass', action: 'original', params: {} };
            var alreadyPlaced = cfg.buttonRows.some(function (row) { return (row.roles || []).includes(role.id); });
            if (!alreadyPlaced) cfg.buttonRows.push({ id: 'managed_row_' + role.id, roles: [role.id] });
          });
        }
        if (id === 'service_renew') {
          roleDefs.filter(function (role) { return role.panelButton; }).forEach(function (role) {
            if (Object.prototype.hasOwnProperty.call(cfg.buttonControls, role.id)) return;
            cfg.buttonControls[role.id] = { enabled: true, style: 'glass', action: 'original', params: {} };
            var alreadyPlaced = cfg.buttonRows.some(function (row) { return (row.roles || []).includes(role.id); });
            if (!alreadyPlaced) cfg.buttonRows.push({ id: 'managed_row_' + role.id, roles: [role.id] });
          });
        }
        var rolesWrap = el('section', null, 'mb-row');
        rolesWrap.appendChild(el('strong', 'چیدمان و کنترل دکمه‌های موجود', 'mb-screen-title'));
        rolesWrap.appendChild(el('p', 'دکمه‌های موجود را مانند منوی اصلی در ردیف‌ها بچینید. برای دکمه‌های وابسته به شناسه اشتراک یا سرویس، عملکرد اصلی قفل است تا لینک، تمدید، حذف و callback امن باقی بماند؛ متن، رنگ و جایگاه قابل تنظیم است.', 'mb-description'));
        function roleDef(roleId) { return roleDefs.find(function (role) { return role.id === roleId; }); }
        function roleLabel(roleId) { var role = roleDef(roleId); return role ? role.label : roleId; }
        function availableRoles(targetRow) {
          // Existing managed buttons can be moved from another row, but cannot be duplicated.
          return roleDefs.filter(function (role) { return !(targetRow.roles || []).includes(role.id); });
        }
        var managedRows = el('div', null, 'mb-rows');
        cfg.buttonRows.forEach(function (row, rowIndex) {
          if (!Array.isArray(row.roles)) row.roles = [];
          var rowCard = el('section', null, 'mb-row');
          var rowHead = el('div', null, 'mb-row-head');
          rowHead.appendChild(el('strong', 'ردیف ' + (rowIndex + 1)));
          rowHead.appendChild(btn('↑', 'mb-icon-button', function () { if (rowIndex > 0) { var temp = cfg.buttonRows[rowIndex-1]; cfg.buttonRows[rowIndex-1] = row; cfg.buttonRows[rowIndex] = temp; render(); } }));
          rowHead.appendChild(btn('↓', 'mb-icon-button', function () { if (rowIndex < cfg.buttonRows.length-1) { var temp = cfg.buttonRows[rowIndex+1]; cfg.buttonRows[rowIndex+1] = row; cfg.buttonRows[rowIndex] = temp; render(); } }));
          rowHead.appendChild(btn('حذف ردیف', 'mb-danger', function () { if ((row.roles || []).indexOf('home') !== -1) cfg.homeButton = false; cfg.buttonRows.splice(rowIndex,1); render(); }));
          rowCard.appendChild(rowHead);
          var grid = el('div', null, 'mb-button-edit-grid');
          row.roles.forEach(function (roleId, buttonIndex) {
            var role = roleDef(roleId); if (!role) return;
            var control = cfg.buttonControls[roleId] || (cfg.buttonControls[roleId] = { enabled:true, label:'{label}', action:'original', style:'glass', params:{} });
            var item = el('div', null, 'mb-button-edit');
            item.appendChild(field('متن دکمه در تلگرام (' + role.label + ')', control.label || '{label}', function (value) { control.label = value; renderPreview(); }));
            var actionWrap = el('label', null, 'mb-field'); actionWrap.appendChild(el('span','عملکرد دکمه'));
            var actionSelect = el('select');
            var originalOpt = el('option','عملکرد اصلی ربات'); originalOpt.value = 'original'; originalOpt.selected = (control.action || 'original') === 'original'; actionSelect.appendChild(originalOpt);
            if (roleId === 'home') {
              Object.keys(state.actions).filter(function (key) { return key !== 'select_panel_buy' && key !== 'select_panel_test'; }).forEach(function (key) { var opt = el('option',state.actions[key].label); opt.value=key; opt.selected=(control.action||'original')===key; actionSelect.appendChild(opt); });
              actionSelect.addEventListener('change',function(){control.action=actionSelect.value;control.params={};render();});
            } else {
              actionSelect.disabled = true; actionSelect.title = 'برای حفظ شناسه‌های زنده، عملکرد این دکمه قابل تغییر نیست.';
            }
            actionWrap.appendChild(actionSelect); item.appendChild(actionWrap);
            if (roleId === 'home' && control.action === 'navigate_menu') {
              var targetWrap = el('label',null,'mb-field'); targetWrap.appendChild(el('span','منوی مقصد'));
              var targetSelect = el('select');
              appendNavigationTargets(targetSelect, (control.params || {}).menuId);
              // Keep the implicit first option in sync with the stored navigation target.
              if (!control.params) control.params = {}; if (!control.params.menuId && targetSelect.options.length) control.params.menuId = targetSelect.value;
              targetSelect.addEventListener('change',function(){control.params.menuId=targetSelect.value;});
              targetWrap.appendChild(targetSelect); item.appendChild(targetWrap);
            }
            if (roleId === 'home' && control.action === 'open_url') item.appendChild(field('لینک HTTPS',(control.params||{}).url,function(value){control.params.url=value;},'https://example.com'));
            var styleWrap = el('label', null, 'mb-field'); styleWrap.appendChild(el('span','رنگ دکمه در تلگرام'));
            var styleSelect = el('select');
            [['glass','شیشه ای'],['primary','آبی'],['success','سبز'],['danger','قرمز']].forEach(function (entry) { var option = el('option',entry[1]); option.value=entry[0]; option.selected=(control.style||'glass')===entry[0]; styleSelect.appendChild(option); });
            styleSelect.addEventListener('change',function(){control.style=styleSelect.value;renderPreview();});
            styleWrap.appendChild(styleSelect); item.appendChild(styleWrap);
            var itemControls = el('div',null,'mb-item-controls');
            itemControls.appendChild(btn('←','mb-icon-button',function(){if(buttonIndex>0){var value=row.roles[buttonIndex-1];row.roles[buttonIndex-1]=roleId;row.roles[buttonIndex]=value;render();}}));
            itemControls.appendChild(btn('→','mb-icon-button',function(){if(buttonIndex<row.roles.length-1){var value=row.roles[buttonIndex+1];row.roles[buttonIndex+1]=roleId;row.roles[buttonIndex]=value;render();}}));
            if (role.panelButton) {
              var visibility = el('label', null, 'mb-field'); var visibilityInput = el('input'); visibilityInput.type = 'checkbox'; visibilityInput.checked = control.enabled !== false; visibilityInput.addEventListener('change', function(){control.enabled = visibilityInput.checked; renderPreview();}); visibility.appendChild(visibilityInput); visibility.appendChild(el('span','نمایش این پنل در این منو')); item.appendChild(visibility);
            } else itemControls.appendChild(btn('حذف دکمه','mb-danger',function(){row.roles.splice(buttonIndex,1);control.enabled=false;if(roleId==='home')cfg.homeButton=false;render();}));
            item.appendChild(itemControls); grid.appendChild(item);
          });
          rowCard.appendChild(grid);
          rowCard.appendChild(btn('+ افزودن دکمه به این ردیف','mb-secondary',function(){
            var choices=availableRoles(row);
            // Keep this picker inline; native prompt dialogs are suppressed in some embedded panels.
            var existingPicker = rowCard.querySelector('.mb-add-role-picker');
            if(existingPicker){existingPicker.remove();return;}
            var picker = el('div',null,'mb-add-role-picker mb-screen-controls');
            if(choices.length){
              var pickerLabel = el('label',null,'mb-field'); pickerLabel.appendChild(el('span','افزودن دکمهٔ موجود به این ردیف'));
              var pickerSelect = el('select');
              choices.forEach(function(role,index){var option=el('option',role.label);option.value=role.id;option.selected=index===0;pickerSelect.appendChild(option);});
              pickerLabel.appendChild(pickerSelect); picker.appendChild(pickerLabel);
              picker.appendChild(btn('افزودن دکمهٔ موجود','mb-button',function(){
                var selectedRole=choices.find(function(role){return role.id===pickerSelect.value;});
                if(!selectedRole)return showStatus('لطفاً یک دکمه انتخاب کنید.',false);
                // Moving an existing button between rows must remove it from its previous row first.
                cfg.buttonRows.forEach(function(otherRow){ if(otherRow !== row && Array.isArray(otherRow.roles)){ otherRow.roles = otherRow.roles.filter(function(roleId){ return roleId !== selectedRole.id; }); } });
                row.roles.push(selectedRole.id);
                var control=cfg.buttonControls[selectedRole.id]||(cfg.buttonControls[selectedRole.id]={enabled:true,label:'{label}',action:'original',style:'glass',params:{}});
                control.enabled=true;
                if(selectedRole.id==='home')cfg.homeButton=true;
                render();
              }));
            }
            if (!['service_test','service_buy'].includes(id)) picker.appendChild(btn('ساخت دکمهٔ سفارشی در این ردیف','mb-button',function(){
              if(!Array.isArray(cfg.buttons))cfg.buttons=[];
              if(cfg.buttons.length>=20)return showStatus('برای هر منو حداکثر ۲۰ دکمهٔ اضافی مجاز است.',false);
              cfg.buttons.push({id:'screen_button_'+Math.random().toString(36).slice(2,7),rowId:row.id,label:'دکمه جدید',action:'back_home',params:{}});
              render();
            }));
            picker.appendChild(btn('انصراف','mb-secondary',function(){picker.remove();}));
            rowCard.appendChild(picker);
          }));
          managedRows.appendChild(rowCard);
        });
        rolesWrap.appendChild(managedRows);
        rolesWrap.appendChild(btn('+ افزودن ردیف', 'mb-secondary', function () { cfg.buttonRows.push({id:'managed_row_'+Math.random().toString(36).slice(2,7),roles:[]}); render(); }));
        section.appendChild(rolesWrap);
      }
      section.appendChild(renderScreenButtons(id, cfg)); details.appendChild(section);
    });
    if (!selectedScreen) {
      var sysDetails = el('details', null, 'mb-dynamic-settings');
      sysDetails.appendChild(el('summary', 'پیام‌های سیستم، خطاها و اعلان‌های ربات', 'mb-heading'));
      sysDetails.appendChild(el('p', 'تمام پیام‌های سیستمی و خطاهای ربات را از اینجا ویرایش کنید. مقدار خالی از متن پیش‌فرض ربات استفاده می‌کند.', 'mb-description'));
      if (!state.draft.systemMessages || typeof state.draft.systemMessages !== 'object') state.draft.systemMessages = {};
      var sysKeys = Object.keys(state.systemMessageDefaults || {});
      if (!sysKeys.length) sysKeys = Object.keys(state.botTexts || {});
      var sysGrid = el('div', null, 'mb-button-edit-grid');
      sysKeys.forEach(function (key) {
        var currentVal = state.draft.systemMessages[key] != null && state.draft.systemMessages[key] !== ''
          ? state.draft.systemMessages[key]
          : (state.botTexts[key] || state.systemMessageDefaults[key] || '');
        sysGrid.appendChild(field(key, currentVal, function (v) { state.draft.systemMessages[key] = v; }));
      });
      sysDetails.appendChild(sysGrid);
      details.appendChild(sysDetails);
    }
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
        var item = renderManagedButton(button);
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
      .replace(/\r\n/g, '\n').replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n')
      .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|li)>/gi, '\n')
      .replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
  }
  function renderPreviewHtml(container, value) {
    var normalized = String(value == null ? '' : value)
      .replace(/\r\n/g, '\n').replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n')
      .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|li)>/gi, '\n')
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
    var tokenRegex = /(<\/?(?:b|strong|i|em|code|pre)>)/gi;
    var parts = normalized.split(tokenRegex);
    var stack = [container];
    parts.forEach(function (part) {
      if (!part) return;
      var open = part.match(/^<(b|strong|i|em|code|pre)>$/i);
      var close = part.match(/^<\/(b|strong|i|em|code|pre)>$/i);
      if (open) {
        var tag = open[1].toLowerCase();
        var node = document.createElement(tag === 'strong' ? 'b' : (tag === 'em' ? 'i' : tag));
        stack[stack.length - 1].appendChild(node);
        stack.push(node);
      } else if (close) {
        if (stack.length > 1) stack.pop();
      } else {
        stack[stack.length - 1].appendChild(document.createTextNode(part.replace(/<[^>]*>/g, '')));
      }
    });
  }
  function renderPreview() {
    if (!preview || !state.draft) return;
    ensureScreens();
    preview.replaceChildren();
    preview.appendChild(el('div', 'پیش‌نمایش تلگرام', 'mb-preview-kicker'));
    var chooser = el('label', null, 'mb-field'); chooser.appendChild(el('span', 'نمایش پیش‌نمایش'));
    var select = el('select');
    [['menu','منوی انتخاب‌شده']].concat(Object.keys(screenNames).map(function (k) { return [k, screenNames[k]]; })).forEach(function (entry) { var opt = el('option', entry[1]); opt.value = entry[0]; opt.selected = state.previewScreen === entry[0]; select.appendChild(opt); });
    select.addEventListener('change', function () { state.previewScreen = select.value; renderPreview(); });
    chooser.appendChild(select); preview.appendChild(chooser);
    var title = 'Artiq VPN';
    var message = '';
    var rows = [];
    var style = 'default';
    if (state.previewScreen === 'menu') {
      var selected = menu(); message = (selected.text || (state.botTexts && state.botTexts.start) || 'متن پیام در این قسمت نمایش داده می‌شود.').replace(/\\{debt\\}/g, '125,000');
      rows = selected.rows.map(function (row) { return row.buttons.map(function (button) { return { label: button.label || 'Button', style: button.style || 'glass' }; }); });
    } else {
      var cfg = state.draft.screens[state.previewScreen] || {};
      var firstPanel = state.panels[0] || { name: 'سرویس اصلی', panelId: '' };
      var realPlanRows = (state.plans || []).filter(function (p) { return !firstPanel.panelId || String(p.panelId || '') === String(firstPanel.panelId); }).slice(0, 6).map(function (p) {
        var priceTxt = p.price != null ? (' — ' + Number(p.price).toLocaleString('en-US') + ' تومان') : '';
        return [{ label: (p.buttonText || p.name) + priceTxt, style: 'glass', role: 'plans' }];
      });
      if (!realPlanRows.length) realPlanRows = [[{ label: '📦 پلن نمونه', style: 'glass', role: 'plans' }]];
      var samples = {
        service_test: { title: 'انتخاب سرویس اکانت تست', rows: [[{ label: firstPanel.name, role: firstPanel.id }], [{ label: '🏠 منوی اصلی', role: 'home' }]] },
        service_buy: { title: 'انتخاب سرویس برای خرید', rows: [[{ label: firstPanel.name, role: firstPanel.id }], [{ label: '🏠 منوی اصلی', role: 'home' }]] },
        service_renew: { title: 'انتخاب سرویس برای تمدید', rows: [[{ label: firstPanel.name, role: firstPanel.id }], [{ label: '🏠 منوی اصلی', role: 'home' }]] },
        plans_buy: { title: 'پلن‌های خرید', rows: realPlanRows.concat([[{ label: cfg.customPlanLabel || '🛠 ساخت بسته دلخواه (حجم و زمان)', role: 'custom_plan' }], [{ label: '🏠 منوی اصلی', role: 'home' }]]) },
        plans_renew: { title: 'پلن‌های تمدید', rows: realPlanRows.concat([[{ label: '🏠 منوی اصلی', role: 'home' }]]) },
        account_list: { title: 'حساب من', rows: [[{ label: 'TG_user_1234', role: 'subscription_detail' }], [{ label: cfg.renewLabel || '🔁', role: 'subscription_renew' }, { label: cfg.removeLabel || '❌', role: 'subscription_remove' }], [{ label: '🏠 منوی اصلی', role: 'home' }]] },
        account_detail: { title: 'جزئیات اشتراک', rows: [[{ label: cfg.openLabel || '🔗 باز کردن لینک', role: 'open_link' }, { label: cfg.copyLabel || '📋 کپی لینک', role: 'copy_link' }], [{ label: cfg.renewLabel || '🔄 تمدید اشتراک', role: 'renew_subscription' }], [{ label: cfg.backLabel || '⬅️ بازگشت به اشتراک‌ها', role: 'back_to_list' }], [{ label: '🏠 منوی اصلی', role: 'home' }]] },
        account_remove: { title: 'تأیید حذف اشتراک', rows: [[{ label: cfg.confirmLabel || '🗑️ بله، حذف اشتراک', role: 'confirm_remove' }], [{ label: cfg.cancelLabel || '↩️ انصراف', role: 'cancel_remove' }]] },
        wallet: { title: 'کیف پول', rows: [[{ label: '🏠 منوی اصلی', role: 'home' }]] },
        support: { title: 'پشتیبانی', rows: [[{ label: '🏠 منوی اصلی', role: 'home' }]] },
        subscription_name: { title: 'درخواست نام اشتراک', rows: [[{ label: state.botButtons.autoName || '⚡ نام خودکار', role: 'auto_name' }], [{ label: '🏠 منوی اصلی', role: 'home' }]] },
        wallet_checkout: { title: 'شارژ برای خرید', rows: [[{ label: '💳 شارژ حداقل ۱۰۰,۰۰۰ تومان', role: 'charge' }], [{ label: '🏠 منوی اصلی', role: 'home' }]] },
        wallet_topup: { title: 'پرداخت کارت‌به‌کارت', rows: [[{ label: state.botButtons.copyCard || '📋 کپی شماره کارت', role: 'copy_card' }], [{ label: '🏠 منوی اصلی', role: 'home' }]] },
        subscription_delivery: { title: 'تحویل اشتراک', rows: [[{ label: state.botButtons.copySubscription || '📋 کپی لینک اشتراک', role: 'copy_sub' }], [{ label: state.botButtons.openSubscription || '🔗 باز کردن لینک اشتراک', role: 'open_sub' }], [{ label: '🏠 منوی اصلی', role: 'home' }]] },
        renewal_delivery: { title: 'تحویل تمدید', rows: [[{ label: state.botButtons.copySubscription || '📋 کپی لینک اشتراک', role: 'copy_sub' }], [{ label: state.botButtons.openSubscription || '🔗 باز کردن لینک اشتراک', role: 'open_sub' }], [{ label: '🏠 منوی اصلی', role: 'home' }]] },
        copy_sub: { title: 'کپی لینک اشتراک', rows: [[{ label: '📋 کپی لینک اشتراک', role: 'copy_link' }], [{ label: '⬅️ بازگشت', role: 'back_to_detail' }]] },
        account_empty: { title: 'حساب بدون اشتراک', rows: [[{ label: '🏠 منوی اصلی', role: 'home' }]] },
        custom_traffic: { title: 'بسته دلخواه — حجم', rows: [[{ label: '🏠 منوی اصلی', role: 'home' }]] },
        custom_duration: { title: 'بسته دلخواه — مدت', rows: [[{ label: '🏠 منوی اصلی', role: 'home' }]] },
        force_join: { title: 'عضویت اجباری', rows: [[{ label: '📢 عضویت در کانال', role: 'join_channel' }], [{ label: '✅ بررسی عضویت', role: 'check_join' }], [{ label: '🏠 منوی اصلی', role: 'home' }]] }
      };
      var sample = samples[state.previewScreen] || samples.service_buy;
      title = sample.title;
      var botTexts = state.botTexts || {};
      var values = {
        service: firstPanel.name || 'سرویس اصلی',
        prompt: botTexts.planPrompt || 'لطفاً بسته مورد نظر را انتخاب کنید:',
        title: sample.title,
        mode: state.previewScreen.indexOf('renew') !== -1 ? 'تمدید' : 'خرید',
        support_username: state.supportUsername || 'Your_Personal_ID',
        debt: '125,000',
        balance: '125,000',
        price: '200,000',
        missing: '75,000',
        amount: '200,000',
        card: '6219 8619 4708 0387',
        holder: 'مدیریت فروشگاه',
        plan_name: (state.plans[0] && state.plans[0].name) || 'پلن ۱۰ گیگ',
        username: 'TG_user_1234',
        sub_url: 'https://sub.example.com/abc',
        expire: '۳۰ روز دیگر',
        min_traffic: '1',
        max_traffic: '1000',
        traffic: '20',
        max_days: '150'
      };
      var template = cfg.messageTemplate != null && String(cfg.messageTemplate) !== '' ? String(cfg.messageTemplate) : defaultScreenMessageTemplate(state.previewScreen);
      message = template.replace(/\{([a-zA-Z0-9_]+)\}/g, function (m, key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : m; });
      rows = sample.rows.map(function (row) { return row.map(function (b) { return { label: b.label, style: 'glass', role: b.role }; }); });
      if (state.previewScreen === 'service_test' || state.previewScreen === 'service_buy' || state.previewScreen === 'service_renew') {
        var eligiblePanels = state.panels.filter(function(panel){return state.previewScreen === 'service_test' ? panel.testEnabled !== false : panel.purchaseEnabled !== false;});
        if (eligiblePanels.length) {
          rows = eligiblePanels.map(function(panel){return [{label:panel.name,style:'glass',role:panel.id}];});
          if (cfg.homeButton !== false) rows.push([{label:'🏠 منوی اصلی',style:'glass',role:'home'}]);
        }
      }
      style = cfg.buttonStyle || 'glass';
      if (state.previewScreen === 'plans_buy') {
        if (cfg.customPlanButton === false) rows = rows.filter(function (row) { return !row[0] || row[0].role !== 'custom_plan'; });
        else if (cfg.customPlanLabel) rows.forEach(function (row) { row.forEach(function (b) { if (b.role === 'custom_plan') b.label = cfg.customPlanLabel; }); });
      }
      if (state.previewScreen === 'account_list') {
        rows[0][0].label = String(cfg.detailLabel || '{title}').replace(/\{title\}/g, 'TG_user_1234');
      }
      if (state.previewScreen === 'account_detail') {
        rows[0][0].label = cfg.openLabel || '🔗 باز کردن لینک'; rows[0][1].label = cfg.copyLabel || '📋 کپی لینک';
        rows[1][0].label = cfg.renewLabel || '🔄 تمدید اشتراک'; rows[2][0].label = cfg.backLabel || '⬅️ بازگشت به اشتراک‌ها';
        if (cfg.homeButton === false) rows.pop();
      }
      if (state.previewScreen === 'account_remove') { rows[0][0].label = cfg.confirmLabel || '🗑️ بله، حذف اشتراک'; rows[1][0].label = cfg.cancelLabel || '↩️ انصراف'; }
      if (cfg.homeButton === false && ['service_test','service_buy','service_renew','plans_buy','plans_renew','account_list','wallet','support'].indexOf(state.previewScreen) !== -1) rows = rows.filter(function (row) { return row[0] && row[0].label !== '🏠 منوی اصلی'; });
      function previewRole(label, button) {
        if (button && button.role) return button.role;
        if (label === '🏠 منوی اصلی') return 'home';
        if (state.previewScreen.indexOf('service_') === 0 && /سرویس/.test(label)) return 'services';
        if (state.previewScreen === 'plans_buy' && /ساخت بسته دلخواه/.test(label)) return 'custom_plan';
        if (state.previewScreen.indexOf('plans_') === 0 && /پلن/.test(label)) return 'plans';
        if (state.previewScreen === 'account_list') {
          if (/اشتراک من/.test(label)) return 'subscription_detail';
          if (/🔁|تمدید/.test(label)) return 'subscription_renew';
          if (/❌|حذف/.test(label)) return 'subscription_remove';
        }
        if (state.previewScreen === 'account_detail') {
          if (/باز کردن لینک/.test(label)) return 'open_link';
          if (/کپی لینک/.test(label)) return 'copy_link';
          if (/تمدید اشتراک/.test(label)) return 'renew_subscription';
          if (/بازگشت به اشتراک‌ها/.test(label)) return 'back_to_list';
        }
        if (state.previewScreen === 'account_remove') {
          if (/بله، حذف/.test(label)) return 'confirm_remove';
          if (/انصراف/.test(label)) return 'cancel_remove';
        }
        return null;
      }
      var sourcePreviewRows = rows;
      var controlledPreviewRows = sourcePreviewRows.map(function (row) {
        return row.map(function (button) {
          var roleId = previewRole(button.label, button);
          var control = roleId && cfg.buttonControls && cfg.buttonControls[roleId];
          if (control) {
            if (control.enabled === false) return null;
            button.label = String(control.label || '{label}').replace(/\{label\}/g, button.label);
            button.style = control.style || 'glass';
          }
          return { button: button, role: roleId };
        }).filter(Boolean);
      });
      if (Array.isArray(cfg.buttonRows)) {
        rows = [];
        if (state.previewScreen === 'service_test' || state.previewScreen === 'service_buy') {
          var allPreviewItems = controlledPreviewRows.flat(); var assignedPreview = [];
          cfg.buttonRows.forEach(function(layoutRow){var roles=Array.isArray(layoutRow.roles)?layoutRow.roles:[];var chosen=[];roles.forEach(function(roleId){allPreviewItems.forEach(function(item){if(item.role===roleId&&assignedPreview.indexOf(item)===-1&&chosen.indexOf(item)===-1)chosen.push(item);});});chosen.forEach(function(item){assignedPreview.push(item);});if(chosen.length)rows.push(chosen.map(function(item){return item.button;}));});
          allPreviewItems.filter(function(item){return assignedPreview.indexOf(item)===-1;}).forEach(function(item){rows.push([item.button]);});
        } else controlledPreviewRows.forEach(function (sourceRow) {
          var assigned = [];
          cfg.buttonRows.forEach(function (layoutRow) {
            var roles = Array.isArray(layoutRow.roles) ? layoutRow.roles : [];
            var selected = sourceRow.filter(function (item) { return item.role && roles.indexOf(item.role) !== -1 && assigned.indexOf(item) === -1; });
            selected.forEach(function (item) { assigned.push(item); });
            if (selected.length) rows.push(selected.map(function (item) { return item.button; }));
          });
          var leftovers = sourceRow.filter(function (item) { return !item.role && assigned.indexOf(item) === -1; });
          if (leftovers.length) rows.push(leftovers.map(function (item) { return item.button; }));
        });
      } else {
        rows = controlledPreviewRows.map(function (row) { return row.map(function (item) { return item.button; }); });
      }
      var extraPreviewRows = [];
      (cfg.buttons || []).forEach(function (button, index) {
        var key = button.rowId || ('legacy:' + (button.id || index));
        var group = extraPreviewRows.find(function (item) { return item.key === key; });
        if (!group) { group = { key: key, buttons: [] }; extraPreviewRows.push(group); }
        group.buttons.push({ label: button.label || 'دکمه جدید', style: button.style || 'glass' });
      });
      extraPreviewRows.forEach(function (group) { rows.push(group.buttons); });
      if (Array.isArray(cfg.buttonRows)) {
        // Explicit managed rows above remain intact; custom buttons keep their own rows.
      } else if (Array.isArray(cfg.rowLayout) && cfg.rowLayout.length) {
        var flat = rows.flat(); rows = []; var offset = 0;
        cfg.rowLayout.forEach(function (rowWidth) { var width = Math.max(1, Math.min(4, Number(rowWidth) || 1)); if (offset < flat.length) { rows.push(flat.slice(offset, offset + width)); offset += width; } });
        var fallbackWidth = Math.max(1, Math.min(4, Number(cfg.columns) || 1));
        while (offset < flat.length) { rows.push(flat.slice(offset, offset + fallbackWidth)); offset += fallbackWidth; }
      } else if (Number(cfg.columns)>0) { var width=Math.max(1,Math.min(4,Number(cfg.columns)||1)), flat=rows.flat(); rows=[]; for(var ri=0;ri<flat.length;ri+=width) rows.push(flat.slice(ri,ri+width)); }
    }
    preview.appendChild(el('div', title, 'mb-preview-name'));
    var previewTextEl = el('div', null, 'mb-preview-text');
    renderPreviewHtml(previewTextEl, message || 'متن پیام در این قسمت نمایش داده می‌شود.');
    preview.appendChild(previewTextEl);
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
    var saveBtn = btn('ذخیره پیش‌نویس', 'mb-secondary', async function () { saveBtn.disabled = true; try { var result = await api('save_draft', { document: state.draft }); state.draft = result.draft; showStatus('پیش‌نویس ذخیره شد؛ تا زمان انتشار در ربات فعال نمی‌شود.', true); } catch (e) { showStatus(e.message, false); } finally { saveBtn.disabled = false; } });
    actions.appendChild(saveBtn);
    var publishBtn = btn('انتشار در ربات', 'mb-button', async function () { if (!window.confirm('این تنظیمات منو در ربات فعال منتشر شود؟')) return; publishBtn.disabled = true; try { await api('save_draft', { document: state.draft }); var result = await api('publish'); state.published = result.published; showStatus('نسخه منتشرشده ' + result.published.version + '؛ ربات از این تنظیمات برای پیام‌های منو استفاده می‌کند.', true); } catch (e) { showStatus(e.message, false); } finally { publishBtn.disabled = false; } });
    actions.appendChild(publishBtn);
    var historySelect = el('select'); historySelect.setAttribute('aria-label', 'نسخه قبلی منتشرشده');
    actions.appendChild(historySelect);
    var rollbackBtn = btn('بازگردانی نسخه', 'mb-danger', async function () { var version = Number(historySelect.value); if (!version || !window.confirm('به نسخه ' + version + ' بازگردانی شود؟')) return; rollbackBtn.disabled = true; try { var result = await api('rollback', { version: version }); state.published = result.published; showStatus('به نسخه ' + version + '.', true); } catch (e) { showStatus(e.message, false); } finally { rollbackBtn.disabled = false; } });
    actions.appendChild(rollbackBtn);
    card.appendChild(actions); status = el('div'); card.appendChild(status);
    app.insertBefore(card, app.firstChild);
    api().then(function (data) {
      state.actions = data.actions || {}; state.botTexts = data.botTexts || {}; state.systemMessageDefaults = data.systemMessageDefaults || {}; state.botButtons = data.botButtons || {}; state.supportUsername = data.supportUsername || ''; state.plans = Array.isArray(data.plans) ? data.plans : []; state.panels = Array.isArray(data.panels) ? data.panels : []; state.draft = data.draft; if (!state.draft.systemMessages || typeof state.draft.systemMessages !== 'object') state.draft.systemMessages = {}; ensureScreens(); state.published = data.published; state.history = data.history || [];
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
