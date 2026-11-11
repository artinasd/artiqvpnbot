const { AsyncLocalStorage } = require('node:async_hooks');
const requestStorage = new AsyncLocalStorage();

function createContext(userId = null) {
  return { userId: userId == null ? null : String(userId), cache: new Map(), inflight: new Map() };
}

function setUserId(userId) {
  const current = requestStorage.getStore();
  if (current && typeof current === 'object') {
    current.userId = String(userId);
    return;
  }
  requestStorage.enterWith(createContext(userId));
}

function getUserId() {
  const current = requestStorage.getStore();
  return current && typeof current === 'object' ? current.userId || null : null;
}

function getContext() {
  const current = requestStorage.getStore();
  return current && typeof current === 'object' ? current : null;
}

try {
  const { Telegraf } = require('telegraf');
  if (!Telegraf.prototype.__artiqRequestContextPatched) {
    const original = Telegraf.prototype.handleUpdate;
    Telegraf.prototype.handleUpdate = function(update, webhookResponse) {
      const id = update?.message?.from?.id
        ?? update?.callback_query?.from?.id
        ?? update?.edited_message?.from?.id
        ?? update?.channel_post?.from?.id
        ?? update?.inline_query?.from?.id
        ?? update?.chosen_inline_result?.from?.id
        ?? update?.my_chat_member?.from?.id
        ?? update?.chat_member?.from?.id
        ?? null;
      return requestStorage.run(createContext(id), () => original.call(this, update, webhookResponse));
    };
    Telegraf.prototype.__artiqRequestContextPatched = true;
  }
} catch {}

module.exports = { setUserId, getUserId, getContext };
