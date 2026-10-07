const { Telegraf } = require('telegraf');
const storage = require('../lib/storage');
const adminMessaging = require('../lib/admin-messaging');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;
const bot = new Telegraf(BOT_TOKEN || 'INVALID_TOKEN');

function log(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const authHeader = req.headers.authorization || '';
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send('Unauthorized');
  }

  try {
    await adminMessaging.processActiveBroadcasts(bot, { storage, log });
    const { processExpirationReminders } = require('../lib/reminders');
    await processExpirationReminders(bot, { storage, log });
    const { checkHealth } = require('../lib/provider-health');
    await checkHealth(log);
    return res.status(200).send('Cron processed');
  } catch (error) {
    log('CRON_ERROR', { error: error.message || String(error) });
    return res.status(500).send('Cron failed');
  }
};
