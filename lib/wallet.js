const storage=require('./storage');
async function getBalance(userId){const user=await storage.getUser(userId);return Number(user?.balance||0);}
async function setBalance(userId,balance,meta={}){const user=await storage.getUser(userId);if(!user)throw new Error('USER_NOT_FOUND');const value=Number(balance);if(!Number.isFinite(value)||value<0)throw new Error('INVALID_BALANCE');return storage.saveUser({...user,balance:value,walletUpdatedAt:new Date().toISOString(),...meta});}
async function adjustBalance(userId,delta,meta={}){const lock=`wallet:${userId}`;if(!(await storage.acquireLock(lock,30)))throw new Error('WALLET_BUSY');try{const user=await storage.getUser(userId);if(!user)throw new Error('USER_NOT_FOUND');const current=Number(user.balance||0);const next=current+Number(delta);if(!Number.isFinite(next)||next<0)throw new Error('INSUFFICIENT_BALANCE');return storage.saveUser({...user,balance:next,walletUpdatedAt:new Date().toISOString(),...meta});}finally{await storage.releaseLock(lock);}}
async function debit(userId,amount,meta={}){return adjustBalance(userId,-Number(amount),meta);}
async function credit(userId,amount,meta={}){return adjustBalance(userId,Number(amount),meta);}
module.exports={getBalance,setBalance,adjustBalance,debit,credit};
