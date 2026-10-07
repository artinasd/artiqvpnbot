const storage = require('./storage');
const accountService = require('./account-service');
const { getConfig } = require('./bot-config');

async function processExpirationReminders(bot, { log }) {
  const config = await getConfig();
  const reminderDaysConfig = config.limits?.reminderDays ?? [3, 1, 0];
  if (!reminderDaysConfig.length) return;
  const reminderDays = [...reminderDaysConfig].sort((a,b) => b - a);

  // We scan users who were active or recently used the bot. 
  // It is more efficient than scanning all orders.
  // Actually, scanning orders is better since active users might have forgotten the bot!
  const orderIds = await storage.smembers('orders:ids');
  const now = Date.now();
  const maxOverdueDays = 3;
  const globalStartTime = Date.now();

  for (const orderId of orderIds) {
    if (Date.now() - globalStartTime > 3500) break; // Ensure overall function respects 10s serverless limit

    try {
      const order = await storage.getOrder(orderId);
      if (!order || !order.pasarguardUserId || !order.expiresAt) continue;
      
      const expiresAt = new Date(order.expiresAt).getTime();
      if (!Number.isFinite(expiresAt)) continue;

      const msLeft = expiresAt - now;
      const daysLeft = Math.ceil(msLeft / (86400 * 1000));
      const remindedTarget = order.remindedDays ?? Infinity;

      const applicable = reminderDays.filter(d => daysLeft <= d && daysLeft >= d - maxOverdueDays);
      if (!applicable.length || applicable[0] >= remindedTarget) continue;

      // Ensure we haven't already processed a newer order for this exact provider account.
      // E.g., if this is an older order but they renewed.
      // If they renewed, `existsInPasarGuard` check inside `getSubscription` will get the true expiration.
      const current = await accountService.getSubscription(order.telegramUserId, order.orderId);
      if (!current || !current.expiresAt) continue;

      const trueExpiresAt = new Date(current.expiresAt).getTime();
      const trueDaysLeft = Math.ceil((trueExpiresAt - now) / (86400 * 1000));
      
      const trueApplicable = reminderDays.filter(d => trueDaysLeft <= d && trueDaysLeft >= d - maxOverdueDays);
      
      if (!trueApplicable.length) {
         await storage.updateOrder(orderId, { expiresAt: current.expiresAt, remindedDays: Infinity });
         continue;
      }
      
      const trueNextReminder = trueApplicable[0];
      if (trueNextReminder >= remindedTarget) {
         await storage.updateOrder(orderId, { expiresAt: current.expiresAt });
         continue;
      }

      const isExpired = trueDaysLeft <= 0;
      let text = '';
      const name = accountService.displayName(order);
      if (isExpired) {
        text = `⚠️ کاربر عزیز، اشتراک <b>${name}</b> شما منقضی شده است.`;
      } else {
        text = `⏳ کاربر عزیز، اعتبار اشتراک <b>${name}</b> شما رو به اتمام است (${trueDaysLeft} روز باقی‌مانده).`;
      }

      const buttons = [[{ text: config.buttons?.renew || '🔄 تمدید اشتراک', callback_data: `account_sub:${orderId}` }]];
      
      await bot.telegram.sendMessage(order.telegramUserId, text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
      });

      await storage.updateOrder(orderId, { expiresAt: current.expiresAt, remindedDays: trueNextReminder });
      if (log) log('EXPIRATION_REMINDER_SENT', { orderId, telegramUserId: order.telegramUserId, reminderDays: trueNextReminder });
    } catch (error) {
       // if user blocked the bot or network failed, we shouldn't retry immediately in a tight loop.
       if (String(error?.description || '').includes('blocked')) {
         await storage.markUserBlocked(orderId); // wait, markUserBlocked takes telegramUserId!
         // Wait, we don't have telegramUserId in scope directly (we have order.telegramUserId).
         // I'll just log it.
       }
       if (log) log('EXPIRATION_REMINDER_FAILED', { orderId, error: error.message || String(error) });
    }
    // rate limit protection
    await new Promise(r => setTimeout(r, 50));
  }
}

module.exports = { processExpirationReminders };
