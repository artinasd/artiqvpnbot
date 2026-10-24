(function () {
  'use strict';

  var app = document.getElementById('app');
  if (!app || app.dataset.cmsShellReady === '1') return;

  var definitions = [
    { id: 'overview', label: 'نمای کلی', description: 'نمایی سریع از وضعیت پنل‌ها و ابزارهای مدیریتی', icon: '◫', group: 'MAIN' },
    { id: 'menus', label: 'سازنده منو', description: 'طراحی منوها، چیدمان دکمه‌ها و اتصال به عملیات ثبت‌شده ربات', icon: '⌘', group: 'BOT', selectors: ['#menuBuilderCard'] },
    { id: 'panels', label: 'پنل‌ها و پلن‌ها', description: 'اتصال پنل‌ها، مدیریت پلن‌ها و قیمت‌گذاری اختصاصی', icon: '▦', group: 'OPERATIONS', selectors: ['#panels-cms-card'] },
    { id: 'settings', label: 'تنظیمات ربات', description: 'تنظیمات پرداخت، محدودیت‌ها و رفتار ربات', icon: '⚙', group: 'BOT', selectors: ['#cardNumber', '#tunnelName', '#button_test'] },
    { id: 'messages', label: 'متن‌های ربات', description: 'مدیریت پیام‌ها، متن‌های نمایشی و متغیرهای قابل استفاده', icon: '☷', group: 'BOT', selectors: ['#message_start'] },
    { id: 'users', label: 'کاربران فعال', description: 'مشاهده کاربران و آخرین وضعیت فعالیت آن‌ها', icon: '♙', group: 'PEOPLE', selectors: ['#activeUsersCmsCard'] },
    { id: 'resellers', label: 'نمایندگان فروش', description: 'مدیریت نمایندگان، نرخ‌ها و اطلاعات حساب آن‌ها', icon: '♧', group: 'PEOPLE', selectors: ['#resellerCmsCard'] },
    { id: 'wallet', label: 'کیف پول', description: 'مدیریت موجودی کیف پول کاربران', icon: '◈', group: 'PEOPLE', selectors: ['#walletCard'] },
    { id: 'debts', label: 'بدهی نمایندگان', description: 'ثبت و پیگیری مبالغ پرداخت‌نشده نمایندگان', icon: '≡', group: 'PEOPLE', selectors: ['#debtCard'] },
    { id: 'access', label: 'عضویت اجباری', description: 'تنظیم کانال‌ها و پیام راهنمای عضویت', icon: '✓', group: 'BOT', selectors: ['#forceJoinCard'] }
  ];

  function element(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = text;
    return el;
  }
  function matchesCard(card, selector) {
    try { return !!card.querySelector(selector) || card.matches(selector); } catch (_) { return false; }
  }
  function pageForCard(card) {
    if (matchesCard(card, '#id') || matchesCard(card, '#plans')) return 'legacy';
    for (var i = 0; i < definitions.length; i++) {
      var def = definitions[i];
      if (!def.selectors) continue;
      for (var j = 0; j < def.selectors.length; j++) {
        if (matchesCard(card, def.selectors[j])) return def.id;
      }
    }
    return 'settings';
  }
  function addStyle() {
    if (document.getElementById('cms-shell-styles')) return;
    var link = document.createElement('link');
    link.id = 'cms-shell-styles';
    link.rel = 'stylesheet';
    link.href = '/admin-shell.css';
    document.head.appendChild(link);
  }
  function makePage(def, host) {
    var page = element('section', 'cms-page');
    page.id = 'cms-page-' + def.id;
    page.dataset.cmsPage = def.id;
    var heading = element('div', 'cms-page-heading');
    heading.appendChild(element('h2', '', def.label));
    heading.appendChild(element('p', '', def.description));
    page.appendChild(heading);
    var body = element('div', 'cms-page-body');
    body.dataset.cmsPageBody = def.id;
    page.appendChild(body);
    host.appendChild(page);
    return page;
  }

  addStyle();
  var main = document.createElement('div');
  main.className = 'cms-main';
  var topbar = element('header', 'cms-topbar');
  var topCopy = element('div', 'cms-topbar-copy');
  topCopy.appendChild(element('div', 'cms-eyebrow', 'ARTIQ  /  CONTROL CENTER'));
  var topTitle = element('h1', 'cms-page-title', 'نمای کلی');
  topTitle.id = 'cms-current-title';
  topCopy.appendChild(topTitle);
  var topDescription = element('div', 'cms-page-description', definitions[0].description);
  topDescription.id = 'cms-current-description';
  topCopy.appendChild(topDescription);
  topbar.appendChild(topCopy);
  var topActions = element('div', 'cms-topbar-actions');
  topActions.appendChild(element('span', 'cms-status', 'محیط مدیریت'));
  var refresh = element('button', 'cms-refresh', '↻ بروزرسانی');
  refresh.type = 'button';
  refresh.addEventListener('click', function () {
    if (currentPage === 'panels') {
      window.dispatchEvent(new CustomEvent('artiq-cms-refresh'));
    } else if (currentPage === 'users') {
      var usersRefresh = document.getElementById('refreshActiveUsers');
      if (usersRefresh) usersRefresh.click();
      else updateStats();
    } else {
      updateStats();
    }
  });
  topActions.appendChild(refresh);
  topbar.appendChild(topActions);
  main.appendChild(topbar);

  var host = element('div', 'cms-pages');
  var pageMap = {};
  definitions.forEach(function (def) { pageMap[def.id] = makePage(def, host); });
  var overview = pageMap.overview.querySelector('[data-cms-page-body]');
  var intro = element('section', 'cms-dashboard-intro');
  intro.appendChild(element('div', 'cms-dashboard-kicker', 'YOUR WORKSPACE'));
  intro.appendChild(element('div', 'cms-dashboard-title', 'به پنل مدیریت آرتیک خوش آمدید'));
  intro.appendChild(element('div', 'cms-dashboard-copy', 'ابزارهای اصلی ربات را از یک فضای یکپارچه مدیریت کنید. هر بخش مستقل است و تغییرات از طریق APIهای فعلی ذخیره می‌شوند.'));
  overview.appendChild(intro);

  var stats = element('div', 'cms-stats-grid');
  var statDefinitions = [
    { id: 'panels', label: 'پنل‌های ثبت‌شده', note: 'از بخش پنل‌ها و پلن‌ها', value: '—' },
    { id: 'plans', label: 'پلن‌های فعال', note: 'در پنل‌های ثبت‌شده', value: '—' },
    { id: 'users', label: 'کاربران نمایش‌داده‌شده', note: 'در فهرست کاربران فعال', value: '—' },
    { id: 'sections', label: 'بخش‌های مدیریتی', note: 'در دسترس در این CMS', value: String(definitions.length - 1) }
  ];
  statDefinitions.forEach(function (stat) {
    var card = element('div', 'cms-stat');
    card.appendChild(element('div', 'cms-stat-label', stat.label));
    var value = element('div', 'cms-stat-value', stat.value);
    value.id = 'cms-stat-' + stat.id;
    card.appendChild(value);
    card.appendChild(element('div', 'cms-stat-note', stat.note));
    stats.appendChild(card);
  });
  overview.appendChild(stats);
  overview.appendChild(element('div', 'cms-section-label', 'دسترسی سریع'));
  var quick = element('div', 'cms-quick-grid');
  var quickItems = [
    { id: 'panels', icon: '▦', title: 'مدیریت پنل‌ها', copy: 'اتصال، پلن‌ها و قیمت‌ها' },
    { id: 'settings', icon: '⚙', title: 'تنظیمات ربات', copy: 'پیکربندی و رفتار سیستم' },
    { id: 'messages', icon: '☷', title: 'متن‌های ربات', copy: 'پیام‌ها و متن‌های قابل ویرایش' },
    { id: 'users', icon: '♙', title: 'کاربران فعال', copy: 'فهرست و وضعیت فعالیت' },
    { id: 'resellers', icon: '♧', title: 'نمایندگان فروش', copy: 'حساب‌ها و نرخ‌های فروش' },
    { id: 'wallet', icon: '◈', title: 'کیف پول', copy: 'موجودی کاربران' }
  ];
  quickItems.forEach(function (item) {
    var button = element('button', 'cms-quick-link');
    button.type = 'button';
    button.dataset.cmsGo = item.id;
    button.appendChild(element('span', 'cms-quick-icon', item.icon));
    var copy = element('span', 'cms-quick-copy');
    copy.appendChild(element('span', '', item.title));
    copy.appendChild(element('small', '', item.copy));
    button.appendChild(copy);
    quick.appendChild(button);
  });
  overview.appendChild(quick);

  var layout = element('div', 'cms-layout');
  var sidebar = element('aside', 'cms-sidebar');
  var brand = element('div', 'cms-brand');
  brand.appendChild(element('div', 'cms-brand-mark', 'A'));
  var brandText = element('div');
  brandText.appendChild(element('div', 'cms-brand-name', 'Artiq VPN'));
  brandText.appendChild(element('div', 'cms-brand-subtitle', 'ADMIN CONSOLE'));
  brand.appendChild(brandText);
  sidebar.appendChild(brand);
  var nav = element('nav', 'cms-nav');
  nav.setAttribute('aria-label', 'بخش‌های مدیریت');
  var groups = ['MAIN', 'OPERATIONS', 'BOT', 'PEOPLE'];
  groups.forEach(function (group) {
    var groupDefs = definitions.filter(function (def) { return def.group === group; });
    if (!groupDefs.length) return;
    var groupWrap = element('div', 'cms-nav-group');
    groupWrap.appendChild(element('div', 'cms-nav-group-label', group === 'MAIN' ? 'داشبورد' : group === 'OPERATIONS' ? 'عملیات' : group === 'BOT' ? 'تنظیمات ربات' : 'مدیریت کاربران'));
    groupDefs.forEach(function (def) {
      var button = element('button', 'cms-nav-button');
      button.type = 'button';
      button.dataset.cmsGo = def.id;
      button.appendChild(element('span', 'cms-nav-icon', def.icon));
      button.appendChild(element('span', '', def.label));
      button.setAttribute('aria-controls', 'cms-page-' + def.id);
      groupWrap.appendChild(button);
    });
    nav.appendChild(groupWrap);
  });
  sidebar.appendChild(nav);
  sidebar.appendChild(element('div', 'cms-sidebar-spacer'));
  var footer = element('div', 'cms-sidebar-footer');
  var security = element('div', 'cms-security-line');
  security.appendChild(element('span', 'cms-security-dot'));
  security.appendChild(element('span', '', 'دسترسی مدیر محافظت‌شده'));
  footer.appendChild(security);
  footer.appendChild(element('div', '', 'Artiq VPN · CMS'));
  sidebar.appendChild(footer);
  layout.appendChild(sidebar);
  main.appendChild(host);
  layout.appendChild(main);

  var brandCard = document.querySelector('main > .card:first-child');
  if (brandCard) brandCard.classList.add('cms-legacy-brand');
  app.dataset.cmsShellReady = '1';
  app.appendChild(layout);

  function moveCard(card) {
    if (!card || card === layout || card.classList.contains('cms-shell-card')) return;
    var pageId = pageForCard(card);
    if (pageId === 'legacy') {
      card.classList.add('cms-hidden-legacy');
      return;
    }
    var page = pageMap[pageId] || pageMap.settings;
    var body = page.querySelector('[data-cms-page-body]');
    if (card.parentNode !== body) body.appendChild(card);
    card.dataset.cmsManagedPage = pageId;
  }
  function placeDirectCards() {
    Array.prototype.slice.call(app.children).forEach(function (child) {
      if (child === layout || !child.classList || !child.classList.contains('card')) return;
      moveCard(child);
    });
    updateStats();
    watchStatsTargets();
  }
  function updateStats() {
    var panels = document.querySelectorAll('#panel-list > .plan').length;
    var plans = document.querySelectorAll('#panel-plan-list > .plan').length;
    var users = document.querySelectorAll('#activeUsersList tbody tr').length;
    var p = document.getElementById('cms-stat-panels');
    var pl = document.getElementById('cms-stat-plans');
    var u = document.getElementById('cms-stat-users');
    if (p) p.textContent = String(panels);
    if (pl) pl.textContent = String(plans);
    if (u) u.textContent = String(users);
  }
  function navigate(id, updateHash) {
    if (!pageMap[id]) id = 'overview';
    definitions.forEach(function (def) {
      pageMap[def.id].classList.toggle('is-active', def.id === id);
    });
    Array.prototype.forEach.call(nav.querySelectorAll('[data-cms-go]'), function (button) {
      if (button.dataset.cmsGo === id) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    var def = definitions.filter(function (item) { return item.id === id; })[0] || definitions[0];
    topTitle.textContent = def.label;
    topDescription.textContent = def.description;
    currentPage = id;
    if (updateHash && window.history && window.history.replaceState) window.history.replaceState(null, '', '#' + id);
    updateStats();
  }
  var currentPage = 'overview';
  document.addEventListener('click', function (event) {
    var button = event.target && event.target.closest ? event.target.closest('[data-cms-go]') : null;
    if (button && pageMap[button.dataset.cmsGo]) navigate(button.dataset.cmsGo, true);
  });
  window.addEventListener('hashchange', function () {
    navigate((window.location.hash || '').slice(1) || 'overview', false);
  });
  var observer = new MutationObserver(function (mutations) {
    var shouldPlace = mutations.some(function (mutation) {
      return Array.prototype.some.call(mutation.addedNodes, function (node) {
        return node.nodeType === 1 && node !== layout && (node.classList.contains('card') || node.querySelector('.card'));
      });
    });
    if (shouldPlace) placeDirectCards();
    updateStats();
  });
  observer.observe(app, { childList: true, subtree: false });
  var overviewObserver = new MutationObserver(updateStats);
  var watchedStatsTargets = [];
  function watchStatsTargets() {
    ['panel-list', 'panel-plan-list', 'activeUsersList'].forEach(function (id) {
      var target = document.getElementById(id);
      if (target && watchedStatsTargets.indexOf(target) === -1) {
        watchedStatsTargets.push(target);
        overviewObserver.observe(target, { childList: true, subtree: true });
      }
    });
  }
  document.addEventListener('artiq-cms-refresh', updateStats);
  placeDirectCards();
  navigate((window.location.hash || '').slice(1) || 'overview', false);
}());
