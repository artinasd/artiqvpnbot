const storage=require('../lib/storage');
const planStore=require('../lib/plan-store');
const PASSWORD=process.env.ADMIN_CMS_PASSWORD||'';
function auth(req){return Boolean(PASSWORD)&&req.headers['x-admin-password']===PASSWORD;}
function json(res,s,b){res.status(s).setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify(b));}
async function resellerUsers(){const ids=await storage.smembers('bot_users');const users=[];for(const id of ids){const user=await storage.getUser(id);if(user&&user.isReseller===true)users.push({telegramUserId:user.telegramUserId,username:user.username||null,firstName:user.firstName||null,lastName:user.lastName||null,isReseller:true,debtLimit:Number(user.debtLimit||0)});}return users.sort((a,b)=>String(a.telegramUserId).localeCompare(String(b.telegramUserId)));}

function paginate(list, pageStr) {
  const page = Math.max(1, parseInt(pageStr) || 1);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = list.slice((safePage - 1) * pageSize, safePage * pageSize);
  return { resellers: paginated, page: safePage, totalPages, totalCount: list.length };
}

module.exports=async function(req,res){
  if(!auth(req))return json(res,401,{error:'UNAUTHORIZED'});
  try{
    if(req.method==='GET'){
      const id=String(req.query?.telegramId||'').trim();
      const pageStr=req.query?.page;
      const plans=await planStore.listAll();
      const allResellers=await resellerUsers();
      const paged = paginate(allResellers, pageStr);
      if(!id)return json(res,200,{user:null,plans, ...paged});
      const user=await storage.getUser(id);
      return json(res,200,{user:user?{telegramUserId:user.telegramUserId,username:user.username||null,firstName:user.firstName||null,lastName:user.lastName||null,isReseller:Boolean(user.isReseller),debtLimit:Number(user.debtLimit||0)}:null,plans, ...paged});
    }
    if(req.method!=='POST')return json(res,405,{error:'METHOD_NOT_ALLOWED'});
    const body=req.body||{};
    const action=String(body.action||'');
    if(action==='set-user'){
      const id=String(body.telegramId||'').trim();
      if(!/^\d+$/.test(id))return json(res,400,{error:'INVALID_TELEGRAM_ID'});
      const user=await storage.getUser(id);
      if(!user)return json(res,404,{error:'USER_NOT_FOUND'});
      await storage.updateWallet(id,{isReseller:Boolean(body.isReseller),resellerUpdatedAt:new Date().toISOString(),resellerUpdatedBy:'cms'});
      const updated=await storage.getUser(id);
      const paged = paginate(await resellerUsers(), body.page);
      return json(res,200,{user:{telegramUserId:updated.telegramUserId,isReseller:Boolean(updated.isReseller),debtLimit:Number(updated.debtLimit||0)}, ...paged});
    }
    if(action==='set-debt-limit'){
      const id=String(body.telegramId||'').trim();
      const limit=Number(body.debtLimit||0);
      if(!/^\d+$/.test(id))return json(res,400,{error:'INVALID_TELEGRAM_ID'});
      const user=await storage.getUser(id);
      if(!user)return json(res,404,{error:'USER_NOT_FOUND'});
      await storage.updateWallet(id,{debtLimit:Math.max(0,limit),debtLimitUpdatedAt:new Date().toISOString()});
      const updated=await storage.getUser(id);
      const paged = paginate(await resellerUsers(), body.page);
      return json(res,200,{user:{telegramUserId:updated.telegramUserId,isReseller:Boolean(updated.isReseller),debtLimit:Number(updated.debtLimit||0)}, ...paged});
    }
    if(action==='set-price'){
      const planId=String(body.planId||'').trim();
      if(!planId)return json(res,400,{error:'PLAN_ID_REQUIRED'});
      const plan=await planStore.get(planId);
      if(!plan)return json(res,404,{error:'PLAN_NOT_FOUND'});
      const value=body.resellerPrice===null||body.resellerPrice===undefined||body.resellerPrice===''?null:Number(body.resellerPrice);
      if(value!==null&&(!Number.isFinite(value)||value<0))return json(res,400,{error:'INVALID_RESELLER_PRICE'});
      const updated=await planStore.save({...plan,resellerPrice:value,price:plan.originalPrice??plan.price});
      return json(res,200,{plan:updated});
    }
    return json(res,400,{error:'INVALID_ACTION'});
  }catch(e){
    return json(res,500,{error:e?.message||'INTERNAL_ERROR'});
  }
};
