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
  return '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Artiq VPN CMS</title><style>body{margin:0;background:#0b1020;color:#eef2ff;font-family:system-ui,sans-serif}main{max-width:1100px;margin:32px auto;padding:18px}.card{background:#121a30;border:1px solid #26314f;border-radius:18px;padding:20px;margin-bottom:18px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}@media(max-width:700px){.grid{grid-template-columns:1fr}}input,select{width:100%;padding:11px;border-radius:10px;border:1px solid #34405f;background:#0c1326;color:#fff}button{border:0;border-radius:10px;padding:10px 14px;color:#fff;background:#3b82f6;font-weight:700;cursor:pointer}.secondary{background:#25304b}.danger{background:#b91c1c}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.plan{display:grid;grid-template-columns:1fr auto;gap:12px;border:1px solid #293552;border-radius:14px;padding:14px;margin:10px 0}.muted{color:#9ca8c7}.hidden{display:none}.error{color:#ff9a9a}.ok{color:#86efac}.title{font-weight:800}.meta{font-size:13px;color:#aeb9d5;margin-top:5px}</style></head><body><main><div class="card"><h1>⚙️ Artiq VPN CMS</h1><p class="muted">مدیریت پلن‌های ربات</p></div><div class="card" id="login"><h3>🔐 ورود مدیر</h3><input id="password" type="password" placeholder="CMS password"><div class="actions"><button id="loginBtn" type="button">ورود</button></div><div id="loginMsg"></div></div><div id="app" class="hidden"><div class="card"><h3>➕ افزودن / ویرایش پلن</h3><div class="grid"><div><label>ID</label><input id="id"></div><div><label>نام</label><input id="name"></div><div><label>قیمت</label><input id="price" type="number" min="0"></div><div><label>مدت روز</label><input id="durationDays" type="number" min="1"></div><div><label>حجم بایت؛ نامحدود = 0</label><input id="trafficBytes" type="number" min="0"></div><div><label>HWID</label><input id="hwidLimit" type="number" min="0" value="0"></div><div><label>نوع</label><select id="type"><option value="traffic">Traffic</option><option value="unlimited">Unlimited</option></select></div><div><label>ترتیب</label><input id="sortOrder" type="number" min="0" value="0"></div></div><div class="actions"><button id="saveBtn" type="button">💾 ذخیره</button><button class="secondary" id="clearBtn" type="button">پاک کردن</button></div><div id="msg"></div></div><div class="card"><h3>📦 پلن‌ها</h3><div id="plans"></div></div></div></main><script src="/admin-cms.js"></script></body></html>';
}

module.exports = async function (req, res) {
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
    if (body.action === 'remove') {
      await planStore.remove(String(body.id || ''));
      return json(res, 200, { ok: true });
    }
    if (body.action === 'reorder') return json(res, 200, { plans: await planStore.reorder(body.ids) });
    return json(res, 400, { error: 'UNKNOWN_ACTION' });
  } catch (error) {
    return json(res, 400, { error: error.message || String(error) });
  }
};
