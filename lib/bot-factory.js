const { Telegraf } = require('telegraf');
const { getTenant, findTenantByBotToken } = require('./tenant-model');

const bots = new Map();
let defaultBotToken = process.env.BOT_TOKEN;

// A module holding a reference to the setup function, to avoid circular dependencies
let setupBotFn = null;
function registerSetupFunction(fn) {
  setupBotFn = fn;
}

async function resolveTenantAndBot(req) {
  let tenantId = req.query?.tenantId || req.headers['x-tenant-id'] || 'default';
  
  // Alternative: match by secret token or token in path
  const botToken = req.query?.token || req.headers['x-telegram-bot-api-secret-token'];
  if (botToken && tenantId === 'default') {
    const tenant = await findTenantByBotToken(botToken);
    if (tenant) {
      tenantId = tenant.tenantId;
    }
  }

  let token = null;
  if (tenantId === 'default') {
    token = defaultBotToken;
  } else {
    const tenant = await getTenant(tenantId);
    if (!tenant) throw new Error('TENANT_NOT_FOUND');
    if (!tenant.botToken) throw new Error('TENANT_BOT_NOT_CONFIGURED');
    token = tenant.botToken;
  }

  if (!token) throw new Error('BOT_TOKEN_MISSING');

  if (!bots.has(tenantId)) {
    const bot = new Telegraf(token);
    if (setupBotFn) {
      setupBotFn(bot);
    }
    bots.set(tenantId, bot);
  }

  return { tenantId, bot: bots.get(tenantId) };
}

// Global accessor for a specific tenant's bot (used in background jobs)
function getBotInstance(tenantId) {
  return bots.get(tenantId);
}

module.exports = {
  resolveTenantAndBot,
  registerSetupFunction,
  getBotInstance
};
