const Markup = require('telegraf').Markup;
const app = require('./app');
const { bot, PLANS, RedisStore, PersistentStageStore, pgRequest } = app;

const store = new RedisStore(
  (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, ''),
  process.env.UPSTASH_REDIS_REST_TOKEN || ''
);
const ADMIN_ID = String(process.env.ADMIN_ID || '');
const stages = new PersistentStageStore(store, 'stage:renew', 1800);
const money = n => `${Number(n).toLocaleString('en-US')} تومان`;
const html = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');
const now = () => new Date().toISOString();
const safeError = e => e?.status ? `PasarGuard HTTP ${e.status}` : String(e?.message || 'Unknown error').slice(0,300);

async function getOrder(id) { return store.get(`order:${id}`); }
async function updateOrder(id, patch) { const old = await getOrder(id); if (!old) throw new Error('Order not found'); const value={...old,...patch,updated_at:now()}; await store.set(`order:${id}`,value); return value; }
async function getUserOrders(id) { const ids=await store.smembers('orders'); const out=[]; for(const oid of ids){const o=await getOrder(oid);if(o?.telegram_user_id===String(id))out.push(o);} return out.sort((a,b)=>b.created_at.localeCompare(a.created_at)); }
async function nextOrderId(){const n=await store.incr('order_sequence');return `TG-${now().slice(0,10).replace(/-/g,'')}-R${n.toString(36).toUpperCase()}`;}

async function notifyAdminReceipt(ctx, order) {
  if (!ADMIN_ID) return;
  const caption = `🔄 <b>رسید تمدید</b>\n\nسفارش: <code>${html(order.order_id)}</code>\nکاربر: <code>${html(order.telegram_user_id)}</code>\nنام کاربری: @${html(ctx.from?.username || 'ندارد')}\nپلن: <b>${html(order.plan_name)}</b>\nمبلغ: <b>${money(order.price)}</b>\nنام اشتراک: <code>${html(order.generated_pasarguard_username)}</code>\nوضعیت: RECEIPT_SUBMITTED`;
  if (ctx.message.photo) await bot.telegram.sendPhoto(ADMIN_ID, ctx.message.photo.at(-1).file_id, { caption, parse_mode:'HTML' });
  else await bot.telegram.sendDocument(ADMIN_ID, ctx.message.document.file_id, { caption, parse_mode:'HTML' });
}

bot.use(async (ctx, next) => { if (ctx.from) await stages.hydrate(ctx.from.id); return next(); });

bot.command('renew', async ctx => {
  const orders=await getUserOrders(ctx.from.id); const active=orders.find(o=>o.fulfillment_status==='FULFILLED' && o.pasarguard_user_id); if(!active)return ctx.reply('❌ اشتراک فعالی برای تمدید پیدا نشد.');
  await stages.set(ctx.from.id,{active});
  const buttons=PLANS.map(p=>[Markup.button.callback(`🔄 ${p.name} - ${money(p.price)}`,`renew:${p.id}`)]);
  await ctx.reply(`اشتراک <code>${html(active.generated_pasarguard_username)}</code> انتخاب شده است.\n\nپلن تمدید را انتخاب کنید:`,{parse_mode:'HTML',...Markup.inlineKeyboard(buttons)});
});

bot.on('callback_query', async ctx => {
  const data=ctx.callbackQuery.data||''; if(!data.startsWith('renew:'))return; await ctx.answerCbQuery().catch(()=>{});
  const stage=stages.get(ctx.from.id); const plan=PLANS.find(p=>p.id===data.slice(6)); if(!stage||!plan)return ctx.reply('❌ درخواست تمدید منقضی شده است. دوباره /renew را بزنید.');
  const orderId=await nextOrderId();
  const order={order_id:orderId,telegram_user_id:String(ctx.from.id),plan_id:plan.id,plan_name:`تمدید ${plan.name}`,traffic_limit_bytes:plan.trafficBytes,duration_days:plan.durationDays,price:plan.price,currency:'IRR',requested_name:stage.active.requested_name,generated_pasarguard_username:stage.active.generated_pasarguard_username,payment_status:'AWAITING_PAYMENT',fulfillment_status:'AWAITING_PAYMENT',pasarguard_user_id:stage.active.pasarguard_user_id,subscription_url:stage.active.subscription_url,created_at:now(),receipt_file_id:null,fulfilled_at:null,failure_reason:null,renewal_of_order_id:stage.active.order_id,renewal_target_expire:null};
  await store.set(`order:${orderId}`,order); await store.sadd('orders',orderId); await stages.set(ctx.from.id,{orderId,plan});
  await ctx.reply(`💳 <b>پرداخت تمدید</b>\n\nسرویس: <code>${html(stage.active.generated_pasarguard_username)}</code>\nپلن: <b>${html(plan.name)}</b>\nمبلغ: <b>${money(plan.price)}</b>\n\n${process.env.BANK_DETAILS||''}\n\n📸 رسید را ارسال کنید. پس از ارسال، بدون تأیید دستی تمدید انجام می‌شود.`,{parse_mode:'HTML'});
});

bot.on('message', async ctx => {
  const stage=stages.get(ctx.from?.id); if(!stage?.orderId)return; const msg=ctx.message; if(!msg.photo&&!msg.document)return;
  const order=await getOrder(stage.orderId); if(!order || ['FULFILLED','RECEIPT_SUBMITTED'].includes(order.payment_status))return;
  const lockKey=`lock:renew:${order.order_id}`; const lockToken=require('crypto').randomUUID(); if(!(await store.acquire(lockKey,lockToken,120)))return ctx.reply('⏳ این تمدید در حال پردازش است؛ لطفاً کمی صبر کنید.');
  try {
    const fileId=msg.photo?msg.photo.at(-1).file_id:msg.document.file_id;
    await updateOrder(order.order_id,{receipt_file_id:fileId,payment_status:'RECEIPT_SUBMITTED',fulfillment_status:'PROVISIONING'});
    try { await notifyAdminReceipt(ctx,order); } catch(e) { console.log(JSON.stringify({event:'ADMIN_RENEWAL_RECEIPT_NOTIFY_FAILED',at:now(),order_id:order.order_id,operation:safeError(e)})); }
    const plan=stage.plan;
    const existing=await pgRequest(`/api/user/by-id/${order.pasarguard_user_id}`);
    let targetExpire=order.renewal_target_expire;
    if (!targetExpire) {
      const currentExpire=existing?.expire ? new Date(existing.expire).getTime() : Date.now();
      targetExpire=new Date(Math.max(currentExpire,Date.now())+plan.durationDays*86400000).toISOString();
      await updateOrder(order.order_id,{renewal_target_expire:targetExpire});
    }
    const targetMs=new Date(targetExpire).getTime();
    const currentMs=existing?.expire ? new Date(existing.expire).getTime() : 0;
    const needsExpireUpdate=currentMs < targetMs;
    const needsTrafficUpdate=Number(existing?.data_limit ?? -1) !== Number(plan.trafficBytes);
    if (needsExpireUpdate || needsTrafficUpdate || existing?.status !== 'active') {
      const body={status:'active',expire:needsExpireUpdate?targetExpire:existing.expire,data_limit:plan.trafficBytes};
      await pgRequest(`/api/user/by-id/${order.pasarguard_user_id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    }
    const latest=await pgRequest(`/api/user/by-id/${order.pasarguard_user_id}`);
    const subscriptionUrl=latest?.subscription_url||existing?.subscription_url||order.subscription_url;
    if(!subscriptionUrl)throw new Error('PasarGuard returned no subscription URL');
    const final=await updateOrder(order.order_id,{subscription_url:subscriptionUrl,fulfillment_status:'FULFILLED',fulfilled_at:now(),failure_reason:null}); await stages.delete(ctx.from.id);
    await ctx.reply(`🎉 <b>تمدید با موفقیت انجام شد.</b>\n\n👤 نام اشتراک: <code>${html(final.generated_pasarguard_username)}</code>\n📦 پلن: ${html(plan.name)}\n⏳ اعتبار جدید: ${html(latest?.expire || targetExpire)}\n\n🔗 لینک اشتراک:\n${html(subscriptionUrl)}`,{parse_mode:'HTML',...Markup.inlineKeyboard([[Markup.button.url('📥 دریافت لینک اشتراک',subscriptionUrl)]])});
  } catch(e) {
    await updateOrder(order.order_id,{fulfillment_status:'FAILED_RECOVERABLE',failure_reason:safeError(e)});
    await ctx.reply('❌ تمدید در حال حاضر ناموفق بود؛ سفارش شما ثبت شده و قابل بازیابی است.');
  } finally { await store.release(lockKey,lockToken).catch(()=>{}); }
});

module.exports = app;
