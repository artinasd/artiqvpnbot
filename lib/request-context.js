const { AsyncLocalStorage } = require('node:async_hooks');
const requestStorage = new AsyncLocalStorage();
function createContext(userId = null) {
  return { userId: userId == null ? null : String(userId), cache: new Map(), inflight: new Map() };
}
function setUserId(userId) {
  const current = requestStorage.getStore();
  if (current && typeof current === 'object') { current.userId = String(userId); return; }
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
function extractUserId(update) {
  return update?.message?.from?.id
    ?? update?.callback_query?.from?.id
    ?? update?.edited_message?.from?.id
    ?? update?.channel_post?.from?.id
    ?? update?.inline_query?.from?.id
    ?? update?.chosen_inline_result?.from?.id
    ?? update?.my_chat_member?.from?.id
    ?? update?.chat_member?.from?.id
    ?? null;
}
function runWithUpdate(update, fn) {
  return requestStorage.run(createContext(extractUserId(update)), fn);
}
function middleware(ctx, next) {
  if (getContext()) return next();
  return runWithUpdate(ctx?.update, next);
}
module.exports = { setUserId, getUserId, getContext, extractUserId, runWithUpdate, middleware };
