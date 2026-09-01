const { AsyncLocalStorage } = require('node:async_hooks');
const storage = new AsyncLocalStorage();
function setUserId(userId){ storage.enterWith(String(userId)); }
function getUserId(){ return storage.getStore() || null; }
module.exports = { setUserId, getUserId };
