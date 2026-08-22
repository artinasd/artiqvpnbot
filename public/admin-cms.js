(function () {
  'use strict';
  var pwd = '';
  var current = [];
  function $(id) { return document.getElementById(id); }
  async function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, opts.headers || {}, {'x-admin-password': pwd, 'content-type': 'application/json'});
    var r = await fetch(path, opts);
    var d = await r.json().catch(function () { return {error: 'BAD_RESPONSE'}; });
    if (!r.ok) throw new Error(d.error || 'REQUEST_FAILED');
    return d;
  }
  async function loadPlans(fromLogin) {
    try {
      var d = await api('/api/admin?data=1');
      current = d.plans || [];
      $('login').classList.add('hidden');
      $('app').classList.remove('hidden');
      render();
    } catch (e) {
      if (fromLogin) $('loginMsg').textContent = '❌ ' + e.message;
      else $('msg').textContent = '❌ ' + e.message;
    }
  }
  function login() {
    pwd = $('password').value;
    if (!pwd) return;
    $('loginMsg').textContent = 'در حال بررسی...';
    loadPlans(true);
  }
  function esc(s) {
    return String(s == null ? '' : s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  }
  function bytes(n) {
    var gb = n / (1024 * 1024 * 1024);
    if (gb >= 1) return (Number.isInteger(gb) ? gb : gb.toFixed(1)) + ' GB';
    return Math.round(n / (1024 * 1024)) + ' MB';
  }
  function render() {
    $('plans').innerHTML = '';
    if (!current.length) { $('plans').innerHTML = '<p class="muted">پلنی وجود ندارد.</p>'; return; }
    current.forEach(function (p) {
      var row = document.createElement('div'); row.className = 'plan' + (p.active ? '' : ' off');
      var info = document.createElement('div');
      var title = document.createElement('div'); title.className = 'title'; title.textContent = p.name + (p.active ? ' · فعال' : ' · غیرفعال');
      var meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = 'ID: ' + p.id + ' · ' + Number(p.price).toLocaleString('en-US') + ' ' + (p.currency || '') + ' · ' + p.durationDays + ' روز · ' + (p.type === 'unlimited' ? 'نامحدود' : bytes(p.trafficBytes)) + ' · HWID ' + p.hwidLimit;
      info.appendChild(title); info.appendChild(meta);
      var actions = document.createElement('div'); actions.className = 'actions';
      var editBtn = document.createElement('button'); editBtn.className = 'secondary'; editBtn.textContent = '✏️ ویرایش'; editBtn.onclick = function () { edit(p.id); }; actions.appendChild(editBtn);
      if (p.active) { var removeBtn = document.createElement('button'); removeBtn.className = 'danger'; removeBtn.textContent = '🗑️ غیرفعال'; removeBtn.onclick = function () { removePlan(p.id); }; actions.appendChild(removeBtn); }
      row.appendChild(info); row.appendChild(actions); $('plans').appendChild(row);
    });
  }
  function edit(id) {
    var p = current.find(function (x) { return x.id === id; }); if (!p) return;
    ['id','name','price','durationDays','trafficBytes','hwidLimit','type','sortOrder'].forEach(function (k) { $(k).value = p[k] == null ? '' : p[k]; });
    window.scrollTo({top:0, behavior:'smooth'});
  }
  function clearForm() {
    ['id','name','price','durationDays','trafficBytes'].forEach(function (k) { $(k).value = ''; });
    $('hwidLimit').value = '0'; $('sortOrder').value = '0'; $('type').value = 'traffic';
  }
  async function savePlan() {
    try {
      var body = {id:$('id').value.trim(), name:$('name').value.trim(), price:Number($('price').value), durationDays:Number($('durationDays').value), trafficBytes:Number($('trafficBytes').value || 0), hwidLimit:Number($('hwidLimit').value || 0), type:$('type').value, sortOrder:Number($('sortOrder').value || 0), active:true};
      await api('/api/admin', {method:'POST', body:JSON.stringify({action:'save', plan:body})});
      $('msg').className='ok'; $('msg').textContent='✅ پلن ذخیره شد.'; clearForm(); await loadPlans();
    } catch(e) { $('msg').className='error'; $('msg').textContent='❌ '+e.message; }
  }
  async function removePlan(id) {
    if (!confirm('این پلن از ربات مخفی شود؟')) return;
    try { await api('/api/admin', {method:'POST', body:JSON.stringify({action:'remove', id:id})}); await loadPlans(); }
    catch(e) { $('msg').className='error'; $('msg').textContent='❌ '+e.message; }
  }
  $('loginBtn').addEventListener('click', login);
  $('password').addEventListener('keydown', function (e) { if (e.key === 'Enter') login(); });
  $('saveBtn').addEventListener('click', savePlan);
  $('clearBtn').addEventListener('click', clearForm);
}());
