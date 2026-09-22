function registerAdminMessaging(bot, { storage, isAdmin, log }) {
  bot.command('sendto', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const raw = String(ctx.message?.text || '').replace(/^\/sendto\s*/i, '').trim();
    const parts = raw.split(/\s+/);
    const telegramId = parts.shift();
    const messageText = parts.join(' ').trim();

    if (!telegramId || !/^[0-9]+$/.test(telegramId) || !messageText) {
      return ctx.reply('❌ استفاده: /sendto <telegram_id> <متن پیام>');
    }

    try {
      await bot.telegram.sendMessage(telegramId, messageText);
      return ctx.reply(`✅ پیام برای کاربر ${telegramId} ارسال شد.`);
    } catch (error) {
      log('ADMIN_SENDTO_FAILED', {
        telegram_user_id: telegramId,
        error: error?.message || String(error),
      });
      return ctx.reply('❌ ارسال پیام ناموفق بود.');
    }
  });

  bot.command('broadcast', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const messageText = String(ctx.message?.text || '').replace(/^\/broadcast\s*/i, '').trim();

    if (!messageText) {
      return ctx.reply('❌ استفاده: /broadcast متن پیام');
    }

    const users = await storage.listActiveBotUsers(10000);
    let success = 0;
    let failed = 0;

    for (const user of users) {
      const telegramId = String(user?.telegramUserId || '');
      if (!/^[0-9]+$/.test(telegramId)) continue;

      try {
        await bot.telegram.sendMessage(telegramId, messageText);
        success++;
      } catch (error) {
        failed++;
        const description = String(error?.description || error?.message || '');
        if (/blocked|chat not found|user is deactivated|bot was blocked/i.test(description)) {
          await storage.markUserBlocked(Number(telegramId), 'BROADCAST_FAILED');
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return ctx.reply(`✅ ارسال پایان یافت. موفق: ${success} | ناموفق: ${failed} | هدف: ${users.length}`);
  });
}

module.exports = { registerAdminMessaging };
