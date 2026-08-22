const planStore = require('../lib/plan-store');

const PASSWORD = process.env.ADMIN_CMS_PASSWORD || '';

function authorized(req) {
  return Boolean(PASSWORD) && req.headers['x-admin-password'] === PASSWORD;
}

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(body));
}

function page() {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Artiq VPN CMS</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b1020;color:#eef2ff;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1100px;margin:32px auto;padding:0 18px}.top{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:22px}.brand{font-size:26px;font-weight:800}.muted{color:#9ca8c7}.card{background:#121a30;border:1px solid #26314f;border-radius:18px;padding:20px;margin-bottom:18px;box-shadow:0 12px 30px #0003}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}@media(max-width:700px){.grid{grid-template-columns:1fr}.top{align-items:flex-start;flex-direction:column}}label{display:block;font-size:13px;color:#aeb9d5;margin-bottom:6px}input,select{width:100%;padding:11px 12px;border-radius:10px;border:1px solid #34405f;background:#0c1326;color:#fff;font:inherit}button{border:0;border-radius:10px;padding:10px 14px;color:#fff;background:#3b82f6;font:inherit;font-weight:700;cursor:pointer}button.secondary{background:#25304b}button.danger{background:#b91c1c}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.plan{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center;border:1px solid #293552;border-radius:14px;padding:14px;margin:10px 0;background:#0e162b}.plan.off{opacity:.5}.title{font-weight:800}.meta{font-size:13px;color:#aeb9d5;margin-top:5px}.pill{display:inline-block;padding:3px 8px;border-radius:999px;background:#18345f;color:#8fc1ff;font-size:12px}.hidden{display:none}.error{color:#ff9a9a;margin-top:8px}.ok{color:#86efac;margin-top:8px}</style></head><body><main>
<div class="top"><div><div class="brand">⚙️ Artiq VPN CMS</div><div class="muted">مدیریت مستقیم پلن‌های ربات تلگرام</div></div><button class="secondary" onclick="loadPlans()">↻ بروزرسانی</button></div>
<div class="card" id="login"><h3>🔐 ورود مدیر</h3><p class="muted">رمز CMS را وارد کنید.</p><input id="password" type="password" placeholder="CMS password"><div class="actions"><button onclick="login()">ورود</button></div><div id="loginMsg"></div></div>
<div id="app" class="hidden"><div class="card"><h3>➕ افزودن / ویرایش پلن</h3><div class="grid"><div><label>ID پلن</label><input id="id" placeholder="plan_100g"></div><div><label>نام پلن</label><input id="name" placeholder="اشتراک 100 گیگ — 1 ماهه"></div><div><label>قیمت</label><input id="price" type="number" min="0"></div><div><label>مدت (روز)</label><input id="durationDays" type="number" min="1"></div><div><label>حجم (بایت) — برای نامحدود 0</label><input id="trafficBytes" type="number" min="0"></div><div><label>HWID Limit</label><input id="hwidLimit" type="number" min="0" value="0"></div><div><label>نوع</label><select id="type"><option value="traffic">Traffic</option><option value="unlimited">Unlimited</option></select></div><div><label>ترتیب نمایش</label><input id="sortOrder" type="number" min="0" value="0"></div></div><div class="actions"><button onclick="savePlan()">💾 ذخیره پلن</button><button class="secondary" onclick="clearForm()">پاک کردن فرم</button></div><div id="msg"></div></div>
<div class="card"><h3>📦 پلن‌ها</h3><div id="plans"></div></div></div></main><script>
let pwd='';let current=[];
const $=id=>document.getElementById(id);const msg=(text,ok=false)=>{$('msg').className=ok?'ok':'error';$('msg').textContent=text};
function login(){pwd=$('password').value;if(!pwd)return;$('loginMsg').textContent='در حال بررسی...';loadPlans(true)}
async function api(path,opts={}){opts.headers={...(opts.headers||{}),'x-admin-password':pwd,'content-type':'application/json'};const r=await fetch(path,opts);const d=await r.json().catch(()=>({error:'BAD_RESPONSE'}));if(!r.ok)throw new Error(d.error||'REQUEST_FAILED');return d}
async function loadPlans(fromLogin=false){try{const d=await api('/api/admin?data=1');current=d.plans||[];$('login').classList.add('hidden');$('app').classList.remove('hidden');render()}catch(e){if(fromLogin)$('loginMsg').textContent='❌ '+e.message;else msg('❌ '+e.message)}}
function render(){if(!current.length){$('plans').innerHTML='<p class="muted">پلنی وجود ندارد.</p>';return}$('plans').innerHTML=current.map(p=>\`<div class="plan \${p.active?'':'off'}"><div><div class="title">\${esc(p.name)} <span class="pill">\${p.active?'فعال':'غیرفعال'}</span></div><div class="meta">ID: \${esc(p.id)} · \${Number(p.price).toLocaleString('en-US')} \${esc(p.currency)} · \${p.durationDays} روز · \${p.type==='unlimited'?'نامحدود':'حجم '+bytes(p.trafficBytes)} · HWID \${p.hwidLimit}</div></div><div class="actions"><button class="secondary" onclick="edit('\${escAttr(p.id)}')">✏️ ویرایش</button>\${p.active?\`<button class="danger" onclick="removePlan('\${escAttr(p.id)}')">🗑️ غیرفعال</button>\`:''}</div></div>\`).join('')}
function bytes(n){const gb=n/(1024**3);if(gb>=1)return Number.isInteger(gb)?gb+' GB':gb.toFixed(1)+' GB';return Math.round(n/(1024**2))+' MB'}
function esc(s){return String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}
function escAttr(s){return String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r/g,'').replace(/\n/g,' ')}
function edit(id){const p=current.find(x=>x.id===id);if(!p)return;['id','name','price','durationDays','trafficBytes','hwidLimit','type','sortOrder'].forEach(k=>$(k).value=p[k]??'');window.scrollTo({top:0,behavior:'smooth'})}
function clearForm(){['id','name','price','durationDays','trafficBytes'].forEach(k=>$(k).value='');$('hwidLimit').value='0';$('sortOrder').value='0';$('type').value='traffic'}
async function savePlan(){try{const body={id:$('id').value,name:$('name').value,price:Number($('price').value),durationDays:Number($('durationDays').value),trafficBytes:Number($('trafficBytes').value||0),hwidLimit:Number($('hwidLimit').value||0),type:$('type').value,sortOrder:Number($('sortOrder').value||0),active:true};await api('/api/admin',{method:'POST',body:JSON.stringify({action:'save',plan:body})});msg('✅ پلن ذخیره شد.',true);clearForm();await loadPlans()}catch(e){msg('❌ '+e.message)}}
async function removePlan(id){if(!confirm('این پلن از ربات مخفی شود؟'))return;try{await api('/api/admin',{method:'POST',body:JSON.stringify({action:'remove',id})});await loadPlans()}catch(e){msg('❌ '+e.message)}}
</script></body></html>`;
}

module.exports = async (req, res) => {
  if (req.method === 'GET' && !req.query?.data) {
    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(page());
  }
  if (!authorized(req)) return json(res, 401, { error: 'UNAUTHORIZED' });
  try {
    if (req.method === 'GET') return json(res, 200, { plans: await planStore.listAll() });
    if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    const body = req.body || {};
    if (body.action === 'save') return json(res, 200, { plan: await planStore.save(body.plan || {}) });
    if (body.action === 'remove') { await planStore.remove(String(body.id || '')); return json(res, 200, { ok: true }); }
    if (body.action === 'reorder') return json(res, 200, { plans: await planStore.reorder(body.ids) });
    return json(res, 400, { error: 'UNKNOWN_ACTION' });
  } catch (error) {
    return json(res, 400, { error: error.message || String(error) });
  }
};
