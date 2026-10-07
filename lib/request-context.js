const { AsyncLocalStorage } = require('node:async_hooks');
const storage = new AsyncLocalStorage();

function setContext(context) { storage.enterWith({ ...storage.getStore(), ...context }); }
function getContext() { return storage.getStore() || {}; }
function setTenantId(tenantId) { setContext({ tenantId: String(tenantId) }); }
function getTenantId() { return getContext().tenantId || 'default'; }
function setUserId(userId) { setContext({ userId: String(userId) }); }
function getUserId() { return getContext().userId || null; }
function setPlatformAdmin(isAdmin) { setContext({ isPlatformAdmin: isAdmin }); }
function isPlatformAdmin() { return Boolean(getContext().isPlatformAdmin); }
function runWithTenant(tenantId, fn) { return storage.run({ ...storage.getStore(), tenantId: String(tenantId) }, fn); }

try {
  const { Telegraf } = require('telegraf');
  if (!Telegraf.prototype.__artiqRequestContextPatched) {
    const original = Telegraf.prototype.handleUpdate;
    Telegraf.prototype.handleUpdate = function(update, webhookResponse) {
      const id = update?.message?.from?.id ?? update?.callback_query?.from?.id ?? update?.edited_message?.from?.id ?? update?.channel_post?.from?.id ?? null;
      // Note: In a multi-tenant webhook, the tenantId should be extracted and passed in before handleUpdate is called,
      // or we extract it from context. Here we just preserve the userId logic, but merge into an object context.
      return id == null ? original.call(this, update, webhookResponse) : storage.run({ userId: String(id) }, () => original.call(this, update, webhookResponse));
    };
    Telegraf.prototype.__artiqRequestContextPatched = true;
  }
} catch {}

module.exports = { setContext, getContext, setTenantId, getTenantId, setUserId, getUserId, setPlatformAdmin, isPlatformAdmin, runWithTenant };
