const crypto = require('crypto');
const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TEST_LIMIT_ENABLED = process.env.TEST_LIMIT_ENABLED == null
  ? true
  : String(process.env.TEST_LIMIT_ENABLED).toLowerCase() === 'true';
const requestContext = require('./request-context');
const memory = new Map();
const memoryExpirations = new Map();
const memorySets = new Map();
const memorySortedSets = new Map();
function configured() { return Boolean(UPSTASH_URL && UPSTASH_TOKEN); }
async function redis(command) { const response = await fetch(UPSTASH_URL,{method:'POST',headers:{Authorization:`Bearer ${UPSTASH_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(command)}); if(!response.ok)throw new Error(`REDIS_HTTP_${response.status}`); const body=await response.json(); if(body.error)throw new Error(`REDIS_${body.error}`); return body.result; }
async function get(key){if(!configured()){const expiresAt=memoryExpirations.get(key);if(expiresAt&&expiresAt<=Date.now()){memory.delete(key);memoryExpirations.delete(key);return null;}return memory.get(key)??null;}const result=await redis(['GET',key]);return result==null?null:JSON.parse(result);}
async function set(key,value,options={}){if(!configured()){const expiresAt=memoryExpirations.get(key);if(expiresAt&&expiresAt<=Date.now()){memory.delete(key);memoryExpirations.delete(key);}if(options.nx&&memory.has(key))return null;memory.set(key,value);if(options.exSeconds)memoryExpirations.set(key,Date.now()+Number(options.exSeconds)*1000);else memoryExpirations.delete(key);return'OK';}const args=['SET',key,JSON.stringify(value)];if(options.nx)args.push('NX');if(options.exSeconds)args.push('EX',String(options.exSeconds));return redis(args);}
async function del(key){if(!configured()){memoryExpirations.delete(key);return memory.delete(key)?1:0;}return redis(['DEL',key]);}
async function sadd(key,member){if(!configured()){if(!memorySets.has(key))memorySets.set(key,new Set());memorySets.get(key).add(String(member));return 1;}return redis(['SADD',key,String(member)]);}
async function srem(key,member){if(!configured()){const setValue=memorySets.get(key);if(!setValue)return 0;return setValue.delete(String(member))?1:0;}return redis(['SREM',key,String(member)]);}
async function smembers(key){if(!configured())return Array.from(memorySets.get(key)||[]);return(await redis(['SMEMBERS',key]))||[];}
async function zadd(key,score,member){if(!configured()){if(!memorySortedSets.has(key))memorySortedSets.set(key,new Map());memorySortedSets.get(key).set(String(member),Number(score));return 1;}return redis(['ZADD',key,String(score),String(member)]);}
async function zrem(key,member){if(!configured()){const setValue=memorySortedSets.get(key);return setValue&&setValue.delete(String(member))?1:0;}return redis(['ZREM',key,String(member)]);}
async function zrangebyscore(key,maxScore,limit=25){if(!configured()){const values=Array.from(memorySortedSets.get(key)||new Map()).filter(([,score])=>score<=Number(maxScore)).sort((a,b)=>a[1]-b[1]).slice(0,limit);return values.map(([member])=>member);}return(await redis(['ZRANGEBYSCORE',key,'-inf',String(maxScore),'LIMIT','0',String(limit)]))||[];}
async function ping(){if(!configured())return false;return(await redis(['PING']))==='PONG';}
function tehranDateKey(date=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
async function createOrder(order){const key=`order:${order.orderId}`;const created=await set(key,order,{nx:true});if(created!=='OK')throw new Error('ORDER_ALREADY_EXISTS');await sadd('orders:ids',order.orderId);await sadd(`user:${order.telegramUserId}:orders`,order.orderId);return order;}
async function getOrder(orderId){return get(`order:${orderId}`);}
async function updateOrder(orderId,patch){const existing=await getOrder(orderId);if(!existing)throw new Error('ORDER_NOT_FOUND');const updated={...existing,...patch,updatedAt:new Date().toISOString()};await set(`order:${orderId}`,updated);if(existing.telegramUserId!==updated.telegramUserId){await srem(`user:${existing.telegramUserId}:orders`,orderId);await sadd(`user:${updated.telegramUserId}:orders`,orderId);}return updated;}
async function listOrders(limit=50){const ids=await smembers('orders:ids');const orders=[];for(let i=0;i<ids.length;i+=50){const batch=await Promise.all(ids.slice(i,i+50).map((id)=>getOrder(id)));for(const order of batch)if(order)orders.push(order);}return orders.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit);}
async function listOrdersFast(limit=50){const ids=await smembers('orders:ids');const orders=[];for(let i=0;i<ids.length;i+=50){const batch=await Promise.all(ids.slice(i,i+50).map((id)=>getOrder(id)));for(const order of batch)if(order)orders.push(order);}return orders.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit);}
async function listAllOrders(){const ids=await smembers('orders:ids');const orders=[];for(let i=0;i<ids.length;i+=25){const batch=await Promise.all(ids.slice(i,i+25).map((id)=>getOrder(id)));for(const order of batch)if(order)orders.push(order);}return orders.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));}
async function listUserOrders(telegramUserId,limit=100){const ids=await smembers(`user:${telegramUserId}:orders`);const orders=[];for(let i=0;i<ids.length;i+=50){const batch=await Promise.all(ids.slice(i,i+50).map((id)=>getOrder(id)));for(const order of batch)if(order)orders.push(order);}return orders.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,limit);}
async function mutateUser(telegramUserId, updater, options={}){const id=String(telegramUserId);const lockName=`wallet:${id}`;let token=null;for(let attempt=0;attempt<40;attempt++){token=await acquireLock(lockName,10);if(token)break;await new Promise(resolve=>setTimeout(resolve,25));}if(!token)throw new Error('USER_UPDATE_BUSY');try{const existing=await get(`user:${id}`);if(!existing&&!options.create)throw new Error('USER_NOT_FOUND');const current=existing||{telegramUserId};const patch=typeof updater==='function'?await updater({...current}):updater;const merged={...current,...(patch||{}),telegramUserId:current.telegramUserId??telegramUserId};if(patch?.testUsed===true){const today=tehranDateKey();if(merged.testUsageDate===today)merged.testUsageCount=Number(merged.testUsageCount||0)+1;else{merged.testUsageDate=today;merged.testUsageCount=1;}}if(patch?.botStatus==null&&merged.botStatus!=='blocked'){merged.botStatus='active';merged.lastSeenAt=patch?.lastSeenAt||new Date().toISOString();}else if(patch?.botStatus==='active'){merged.lastSeenAt=patch.lastSeenAt||new Date().toISOString();merged.blockedAt=null;}await set(`user:${id}`,merged);await sadd('bot_users',id);return merged;}finally{await releaseLock(lockName,token);}}
async function saveUser(user){if(!user||user.telegramUserId==null)throw new Error('INVALID_USER');requestContext.setUserId(user.telegramUserId);return mutateUser(user.telegramUserId,user,{create:true});}
async function markUserActive(telegramUserId,meta={}){return saveUser({...meta,telegramUserId,botStatus:'active',lastSeenAt:new Date().toISOString(),blockedAt:null});}
async function markUserBlocked(telegramUserId,reason='TELEGRAM_BLOCKED'){return saveUser({telegramUserId,botStatus:'blocked',blockedAt:new Date().toISOString(),blockedReason:reason});}
async function listBotUsers(limit=1000){const ids=await smembers('bot_users');const users=[];for(const id of ids){const user=await getUserRaw(id);if(user)users.push(user);}return users.sort((a,b)=>String(b.lastSeenAt||b.updatedAt||'').localeCompare(String(a.lastSeenAt||a.updatedAt||''))).slice(0,limit);}
async function getUserRaw(telegramUserId){return get(`user:${telegramUserId}`);}
async function listActiveBotUsers(limit=1000){const users=await listBotUsers(limit);return users.filter(u=>u.botStatus==='active');}
async function getUser(telegramUserId,testLimitPerDay=2){
  requestContext.setUserId(telegramUserId);
  const user=await get(`user:${telegramUserId}`);
  if(!user)return user;
  let isReseller=user.isReseller===true;
  if(!isReseller){
    const config=await get('cms:bot-config');
    const resellerIds=Array.isArray(config?.resellerTelegramIds)?config.resellerTelegramIds.map(String):[];
    isReseller=resellerIds.includes(String(telegramUserId));
  }
  if(!TEST_LIMIT_ENABLED)return{...user,testUsed:false,...(isReseller?{reseller:true}:{})};
  if(isReseller)return{...user,testUsed:false,reseller:true};
  const today=tehranDateKey();
  const count=user.testUsageDate===today?Number(user.testUsageCount||0):0;
  const limit=Number.isFinite(Number(testLimitPerDay))?Math.max(0,Number(testLimitPerDay)):2;
  return{...user,testUsed:count>=limit,testUsageDate:today,testUsageCount:count};
}
async function setState(type,id,state){if(state==null)return del(`state:${type}:${id}`);return set(`state:${type}:${id}`,state,{exSeconds:86400});}
async function getState(type,id){return get(`state:${type}:${id}`);}
async function deleteState(type,id){return del(`state:${type}:${id}`);}
async function acquireLock(name,ttlSeconds=90){const token=crypto.randomUUID();const result=await set(`lock:${name}`,token,{nx:true,exSeconds:ttlSeconds});return result==='OK'?token:null;}
async function releaseLock(name,token){if(!token)return false;const key=`lock:${name}`;if(!configured()){if(memory.get(key)!==token)return false;memory.delete(key);memoryExpirations.delete(key);return true;}const result=await redis(['EVAL',"if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",'1',key,JSON.stringify(token)]);return Number(result)===1;}
async function createPurchaseReportEvent(event) {
  const eventId = String(event?.eventId || '');
  if (!eventId || !event?.orderId || !event?.recipients || !Object.keys(event.recipients).length) throw new Error('INVALID_PURCHASE_REPORT_EVENT');
  const pendingRecipients = Object.values(event.recipients).filter((recipient) => recipient?.status === 'PENDING');
  if (!pendingRecipients.length) throw new Error('PURCHASE_REPORT_EVENT_HAS_NO_PENDING_RECIPIENTS');
  const dueTimes = pendingRecipients.map((recipient) => recipient.nextAttemptAt ? new Date(recipient.nextAttemptAt).getTime() : Date.now()).filter(Number.isFinite);
  const initialDue = dueTimes.length ? Math.min(...dueTimes) : Date.now();
  const key = `purchase-report:event:${eventId}`;
  const payload = JSON.stringify(event);
  if (!configured()) {
    if (memory.has(key)) return false;
    memory.set(key, event);
    await sadd('purchase-report:pending', eventId);
    await zadd('purchase-report:due', initialDue, eventId);
    return true;
  }
  const result = await redis([
    'EVAL',
    "if redis.call('SET', KEYS[1], ARGV[1], 'NX') then redis.call('SADD', KEYS[2], ARGV[2]); redis.call('ZADD', KEYS[3], ARGV[3], ARGV[2]); return 1 else return 0 end",
    '3',
    key,
    'purchase-report:pending',
    'purchase-report:due',
    payload,
    eventId,
    String(initialDue),
  ]);
  return Number(result) === 1;
}
async function getPurchaseReportEvent(eventId) {
  return get(`purchase-report:event:${String(eventId)}`);
}
async function updatePurchaseReportEvent(eventId, patch) {
  const existing = await getPurchaseReportEvent(eventId);
  if (!existing) throw new Error('PURCHASE_REPORT_EVENT_NOT_FOUND');
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  const recipients = updated.recipients || {};
  const pendingRecipients = Object.values(recipients).filter((recipient) => recipient?.status === 'PENDING');
  const dueTimes = pendingRecipients.map((recipient) => recipient.nextAttemptAt ? new Date(recipient.nextAttemptAt).getTime() : Date.now()).filter(Number.isFinite);
  const dueScore = pendingRecipients.length ? (dueTimes.length ? Math.min(...dueTimes) : Date.now()) : null;
  const completed = Object.values(recipients).length > 0 && Object.values(recipients).every((recipient) => recipient?.status === 'SENT' || recipient?.status === 'SKIPPED');
  if (!configured()) {
    await set(`purchase-report:event:${String(eventId)}`, updated);
    if (dueScore === null) await zrem('purchase-report:due', String(eventId));
    else await zadd('purchase-report:due', dueScore, String(eventId));
    if (completed) await srem('purchase-report:pending', String(eventId));
    return updated;
  }
  await redis([
    'EVAL',
    "redis.call('SET', KEYS[1], ARGV[1]); if ARGV[2] == '' then redis.call('ZREM', KEYS[3], ARGV[3]) else redis.call('ZADD', KEYS[3], ARGV[2], ARGV[3]) end; if ARGV[4] == '1' then redis.call('SREM', KEYS[2], ARGV[3]) end; return 1",
    '3',
    `purchase-report:event:${String(eventId)}`,
    'purchase-report:pending',
    'purchase-report:due',
    JSON.stringify(updated),
    dueScore === null ? '' : String(dueScore),
    String(eventId),
    completed ? '1' : '0',
  ]);
  return updated;
}
async function listPendingPurchaseReportEvents(limit = 25, now = Date.now()) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const ids = await zrangebyscore('purchase-report:due', Number(now), safeLimit);
  const events = await Promise.all(ids.map((id) => getPurchaseReportEvent(id)));
  return events.filter(Boolean);
}
module.exports={configured,get,set,del,sadd,srem,smembers,zadd,zrem,zrangebyscore,ping,createOrder,getOrder,updateOrder,listOrders,listOrdersFast,listAllOrders,listUserOrders,saveUser,mutateUser,getUser,getUserRaw,markUserActive,markUserBlocked,listBotUsers,listActiveBotUsers,setState,getState,deleteState,acquireLock,releaseLock,createPurchaseReportEvent,getPurchaseReportEvent,updatePurchaseReportEvent,listPendingPurchaseReportEvents};
