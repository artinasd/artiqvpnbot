const crypto = require('crypto');
const { Telegraf, Markup } = require('telegraf');
const app = require('./app');
const { bot, PLANS, RedisStore, pgRequest } = app;

const store = new RedisStore(
  (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, ''),
  process.env.UPSTASH_REDIS_REST_TOKEN || ''
);
const ADMIN_ID = String(process.env.ADMIN_ID || '');
const stages = new Map();
const money = n => `${Number(n).toLocaleString('en-US')} تومان`;
const html = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const now = () => new Date().toISOString();

async function getOrder(id) { return store.get(`order:${id}`); }
async function updateOrder(id, patch) { const old = await getOrder(id); if (!old) throw new Error('Order not found'); const value={...old,...patch,updated_at:now()}; await store.set(`order:${id}`,value); return value; }
async function getUserOrders(id) { const ids=await store.smembers('orders'); const out=[]; for(const oid of ids){const o=await getOrder(oid);if(o?.telegram_user_id===String(id))out.push(o);} return out.sort((a,b)=>b.created_at.localeCompare(a.created_at)); }
async function nextOrderId(){const n=await store.incr('order_sequence');return `TG-${now().slice(0,10).replace(/-/g,'')}-R${n.toString(36).toUpperCase()}`;}

bot.command('renew', async ctx => {
  const orders=await getUserOrders(ctx.from.id); const active=orders.find(o=>o.fulfillment_status==='FULFILLED' && o.pasarguard_user_id); if(!active)return ctx.reply('❌ اشتراک فعالی برای تمدید پیدا نشد.');
  stages.set(ctx.from.id,{active});
  const buttons=PLANS.map(p=>[Markup.button.callback(`🔄 ${p.name} - ${money(p.price)}`,`renew:${p.id}`)]);
  await ctx.reply(`اشتراک <code>${html(active.generated_pasarguard_username)}</code> انتخاب شده است.\n\nپلن تمدید را انتخاب کنید:`,{parse_mode:'HTML',...Markup.inlineKeyboard(buttons)});
});

bot.on('callback_query', async ctx => {
  const data=ctx.callbackQuery.data||''; if(!data.startsWith('renew:'))return; await ctx.answerCbQuery().catch(()=>{});
  const stage=stages.get(ctx.from.id); const plan=PLANS.find(p=>p.id===data.slice(6)); if(!stage||!plan)return ctx.reply('❌ درخواست تمدید منقضی شده است. دوباره /renew را بزنید.');
  const orderId=await nextOrderId();
  const order={order_id:orderId,telegram_user_id:String(ctx.from.id),plan_id:plan.id,plan_name:`تمدید ${plan.name}`,traffic_limit_bytes:plan.trafficBytes,duration_days:plan.durationDays,price:plan.price,currency:'IRT',requested_name:stage.active.requested_name,generated_pasarguard_username:stage.active.generated_pasarguard_username,payment_status:'AWAITING_PAYMENT',fulfillment_status:'AWAITING_PAYMENT',pasarguard_user_id:stage.active.pasarguard_user_id,subscription_url:stage.active.subscription_url,created_at:now(),receipt_file_id:null,fulfilled_at:null,failure_reason:null,renewal_of_order_id:stage.active.order_id};
  await store.set(`order:${orderId}`,order); await store.sadd('orders',orderId); stages.set(ctx.from.id,{orderId,plan});
  await ctx.reply(`💳 <b>پرداخت تمدید</b>\n\nسرویس: <code>${html(stage.active.generated_pasarguard_username)}</code>\nپلن: <b>${html(plan.name)}</b>\nمبلغ: <b>${money(plan.price)}</b>\n\n${process.env.BANK_DETAILS||''}\n\n📸 رسید را ارسال کنید. پس از ارسال، بدون تأیید دستی تمدید انجام می‌شود.`,{parse_mode:'HTML'});
});

bot.on('message', async ctx => {
  const stage=stages.get(ctx.from?.id); if(!stage?.orderId)return; const msg=ctx.message; if(!msg.photo&&!msg.document)return;
  const order=await getOrder(stage.orderId); if(!order||order.payment_status==='RECEIPT_SUBMITTED')return;
  const fileId=msg.photo?msg.photo.at(-1).file_id:msg.document.file_id; await updateOrder(order.order_id,{receipt_file_id:fileId,payment_status:'RECEIPT_SUBMITTED',fulfillment_status:'PROVISIONING'});
  try {
    const plan=stage.plan; const existing=await pgRequest(`/api/user/by-id/${order.pasarguard_user_id}`);
    const currentExpire=existing?.expire ? new Date(existing.expire).getTime() : Date.now(); const base=Math.max(currentExpire,Date.now());
    const nextExpire=new Date(base+plan.durationDays*86400000).toISOString();
    const body={status:'active',expire:nextExpire}; if(plan.trafficBytes>0)body.data_limit=plan.trafficBytes; else body.data_limit=0;
    const updated=await pgRequest(`/api/user/by-id/${order.pasarguard_user_id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const subscriptionUrl=updated?.subscription_url||existing?.subscription_url||order.subscription_url;
    const final=await updateOrder(order.order_id,{subscription_url:subscriptionUrl,fulfillment_status:'FULFILLED',fulfilled_at:now()}); stages.delete(ctx.from.id);
    await ctx.reply(`🎉 <b>تمدید با موفقیت انجام شد.</b>\n\n👤 نام اشتراک: <code>${html(final.generated_pasarguard_username)}</code>\n📦 پلن: ${html(plan.name)}\n⏳ اعتبار جدید: ${html(nextExpire)}\n\n🔗 لینک اشتراک:\n${html(subscriptionUrl)}`,{parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.url('📥 دریافت لینک اشتراک',subscriptionUrl)]])});
  } catch(e) { await updateOrder(order.order_id,{fulfillment_status:'FAILED_RECOVERABLE',failure_reason:e.status?`PasarGuard HTTP ${e.status}`:String(e.message).slice(0,300)}); await ctx.reply('❌ تمدید در حال حاضر ناموفق بود؛ سفارش شما ثبت شده و قابل بازیابی است.'); }
});

module.exports = app;
