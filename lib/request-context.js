const { AsyncLocalStorage } = require('node:async_hooks');
const storage = new AsyncLocalStorage();
function setUserId(userId){ storage.enterWith(String(userId)); }
function getUserId(){ return storage.getStore() || null; }
try {
  const { Telegraf } = require('telegraf');
  if (!Telegraf.prototype.__artiqRequestContextPatched) {
    const original = Telegraf.prototype.handleUpdate;
    Telegraf.prototype.handleUpdate = function(update, webhookResponse) {
      const id = update?.message?.from?.id ?? update?.callback_query?.from?.id ?? update?.edited_message?.from?.id ?? update?.channel_post?.from?.id ?? null;
      return id == null ? original.call(this, update, webhookResponse) : storage.run(String(id), () => original.call(this, update, webhookResponse));
    };
    Telegraf.prototype.__artiqRequestContextPatched = true;
  }
} catch {}
module.exports = { setUserId, getUserId };
