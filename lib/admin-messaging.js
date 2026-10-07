const { waitUntil } = require('@vercel/functions');

async function processActiveBroadcasts(bot, { storage, log }) {
  const activeIds = await storage.smembers('active_broadcasts');
  if (!activeIds || activeIds.length === 0) return;

  const globalStartTime = Date.now();
  for (const broadcastId of activeIds) {
    if (Date.now() - globalStartTime > 6000) break; // Ensure overall function respects 10s serverless limit

    const lockName = `broadcast_worker:${broadcastId}`;
    const token = await storage.acquireLock(lockName, 30);
    if (!token) continue; // Concurrency protection

    try {
      const job = await storage.get(`broadcast_job:${broadcastId}`);
      if (!job || job.status === 'completed' || job.status === 'failed') {
        await storage.srem('active_broadcasts', broadcastId);
        continue;
      }

      const startTime = Date.now();
      let sentInThisBatch = 0;
      
      // Bounded execution: run for at most remaining time of the global 6s limit
      while (job.cursor < job.recipients.length && (Date.now() - globalStartTime) < 6000) {
        const recipient = job.recipients[job.cursor];
        
        // Idempotency check: durable per-recipient marker
        const isSentSet = await storage.sadd(`bcast_sent:${broadcastId}`, recipient);
        if (isSentSet === 0) {
           // Already processed
           job.cursor++;
           continue;
        }

        try {
          await bot.telegram.sendMessage(recipient, job.messageText);
          job.success++;
        } catch (error) {
          const description = String(error?.description || error?.message || '');
          if (error.code === 429 || description.includes('retry_after')) {
            // Telegram rate limits
            await storage.srem(`bcast_sent:${broadcastId}`, recipient); // Allow retry
            break; 
          }
          if (/blocked|chat not found|user is deactivated|bot was blocked/i.test(description)) {
            job.failed++;
            await storage.markUserBlocked(Number(recipient), 'BROADCAST_FAILED');
          } else {
            // Transient or other failure, count as failed to prevent infinite loop
            job.failed++;
          }
        }
        
        job.cursor++;
        sentInThisBatch++;
        await new Promise(resolve => setTimeout(resolve, 50)); // Respect Telegram limits
      }

      if (job.cursor >= job.recipients.length) {
        job.status = 'completed';
        await storage.srem('active_broadcasts', broadcastId);
        if (job.adminId) {
          await bot.telegram.sendMessage(job.adminId, `✅ پخش پیام ${broadcastId} پایان یافت.\nموفق: ${job.success} | ناموفق: ${job.failed}`).catch(()=>{});
        }
        // Cleanup marker set (optional, keeping it provides long-term idempotency)
      }

      if (sentInThisBatch > 0 || job.status === 'completed') {
        job.updatedAt = new Date().toISOString();
        await storage.set(`broadcast_job:${broadcastId}`, job);
      }

    } catch (e) {
      log('BROADCAST_WORKER_ERROR', { broadcastId, error: e.message });
    } finally {
      const released = await storage.releaseLock(lockName, token);
      console.log('Lock released:', lockName, released);
    }
  }
}

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

    // Duplicate broadcast protection
    const idempotencyKey = `broadcast_dup:${Buffer.from(messageText).toString('base64').substring(0, 32)}`;
    const isDup = await storage.get(idempotencyKey);
    if (isDup) return ctx.reply('❌ این پیام اخیراً در صف ارسال قرار گرفته است. لطفاً کمی صبر کنید.');

    // We just get all known user IDs to prevent loading thousands of full profiles in memory during Webhook
    // The cron worker will gracefully handle and filter users who blocked the bot during dispatch
    const userIds = await storage.smembers('bot_users');
    const recipients = userIds.filter(id => /^[0-9]+$/.test(id));
    
    if (recipients.length === 0) return ctx.reply('❌ هیچ کاربری برای ارسال یافت نشد.');

    const broadcastId = `bcast_${Date.now()}`;
    const job = {
      id: broadcastId,
      adminId: ctx.from.id,
      messageText,
      recipients,
      cursor: 0,
      success: 0,
      failed: 0,
      status: 'queued',
      createdAt: new Date().toISOString()
    };

    await storage.set(`broadcast_job:${broadcastId}`, job);
    await storage.sadd('active_broadcasts', broadcastId);
    await storage.set(idempotencyKey, 1, { exSeconds: 300 });

    await ctx.reply(`✅ پیام در صف ارسال برای ${recipients.length} کاربر قرار گرفت.\nشناسه: ${broadcastId}\n\nپردازش به صورت دسته‌ای در پس‌زمینه انجام می‌شود.`);
    
    waitUntil(processActiveBroadcasts(bot, { storage, log }).catch(()=>{}));
  });

  bot.command('broadcast_status', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const activeIds = await storage.smembers('active_broadcasts');
    if (!activeIds || activeIds.length === 0) return ctx.reply('هیچ پخشی در حال اجرا نیست.');
    let msg = '📊 وضعیت پخش‌های فعال:\n\n';
    for (const id of activeIds) {
      const job = await storage.get(`broadcast_job:${id}`);
      if (job) {
        msg += `- ${id}: ${job.cursor}/${job.recipients.length} (موفق: ${job.success})\n`;
      }
    }
    await ctx.reply(msg);
  });
}

module.exports = { registerAdminMessaging, processActiveBroadcasts };
