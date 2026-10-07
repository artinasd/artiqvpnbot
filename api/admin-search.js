const storage = require('../lib/storage');
const PASSWORD = process.env.ADMIN_CMS_PASSWORD || '';
function auth(req){return Boolean(PASSWORD)&&req.headers['x-admin-password']===PASSWORD;}
function json(res,status,body){res.status(status).setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify(body));}

module.exports=async function(req,res){
  if(!auth(req))return json(res,401,{error:'UNAUTHORIZED'});
  if(req.method!=='GET')return json(res,405,{error:'METHOD_NOT_ALLOWED'});
  try{
    const query = String(req.query?.q||'').toLowerCase().trim();
    const allIds = await storage.smembers('orders:ids');
    const orders = [];
    const limit = Math.min(allIds.length, 1000);
    const chunks = [];
    for (let i = 0; i < limit; i += 50) {
       chunks.push(allIds.slice(i, i + 50));
    }
    for (const chunk of chunks) {
       await Promise.all(chunk.map(async id => {
         const o = await storage.getOrder(id);
         if (o) orders.push(o);
       }));
    }
    
    orders.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));

    let results = orders;
    if (query) {
      results = orders.filter(o => {
        return String(o.orderId||'').toLowerCase().includes(query) ||
               String(o.telegramUserId||'').toLowerCase().includes(query) ||
               String(o.generatedPasarguardUsername||'').toLowerCase().includes(query) ||
               String(o.pasarguardUserId||'').toLowerCase().includes(query);
      });
    }

    return json(res, 200, { orders: results.slice(0, 100), totalSearched: orders.length });
  }catch(e){
    return json(res,500,{error:e?.message||'INTERNAL_ERROR'});
  }
};
