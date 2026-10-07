const { Telegraf } = require('telegraf');
const storage = require('../lib/storage');
const adminMessaging = require('../lib/admin-messaging');
const { listTenants } = require('../lib/tenant-model');
const { runWithTenant } = require('../lib/request-context');
const { getBotInstance, resolveTenantAndBot } = require('../lib/bot-factory');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CRON_SECRET = process.env.CRON_SECRET;

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
    const tenants = await listTenants(100);
    const tenantsToProcess = [{ tenantId: 'default' }, ...tenants];
    
    for (const tenant of tenantsToProcess) {
      await runWithTenant(tenant.tenantId, async () => {
        try {
          // Initialize bot via factory if not already created
          const reqMock = { headers: { 'x-tenant-id': tenant.tenantId } };
          const { bot } = await resolveTenantAndBot(reqMock).catch(() => ({ bot: null }));
          if (!bot) return;

          await adminMessaging.processActiveBroadcasts(bot, { storage, log });
          const { processExpirationReminders } = require('../lib/reminders');
          await processExpirationReminders(bot, { storage, log });
          
          if (tenant.tenantId === 'default') {
            const { checkHealth } = require('../lib/provider-health');
            await checkHealth(log);
          }
        } catch (e) {
          log('TENANT_CRON_ERROR', { tenantId: tenant.tenantId, error: e.message });
        }
      });
    }

    return res.status(200).send('Cron processed');
  } catch (error) {
    log('CRON_ERROR', { error: error.message || String(error) });
    return res.status(500).send('Cron failed');
  }
};
