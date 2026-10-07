const storage = require('../lib/storage');

const WALLET_FIELDS = [
  'balance', 'debtLimit', 'isReseller', 
  'resellerUpdatedAt', 'resellerUpdatedBy', 
  'walletUpdatedAt', 'walletUpdatedBy', 
  'walletLastTransaction', 'walletLastCredit', 
  'walletLastCreditAt', 'walletLastRefund', 
  'walletLastRefundAt', 'debtLimitUpdatedAt'
];

async function migrate() {
  console.log('Starting wallet migration...');
  const ids = await storage.smembers('bot_users');
  console.log(`Found ${ids.length} users to check.`);
  
  let migrated = 0;
  for (const id of ids) {
    // Read the raw user JSON
    const user = await storage.get(`user:${id}`);
    if (!user) continue;

    const toMigrate = {};
    let needsMigration = false;

    for (const f of WALLET_FIELDS) {
      if (user[f] !== undefined) {
        toMigrate[f] = user[f];
        needsMigration = true;
      }
    }

    if (needsMigration) {
      // 1. Move fields to the wallet key atomically
      await storage.updateWallet(id, toMigrate, false);
      
      // 2. Remove fields from the user key
      const strippedUser = { ...user };
      for (const f of WALLET_FIELDS) delete strippedUser[f];
      
      // 3. Save stripped user
      await storage.set(`user:${id}`, strippedUser);
      migrated++;
      console.log(`Migrated user ${id} (balance: ${toMigrate.balance || 0}, reseller: ${toMigrate.isReseller || false})`);
    }
  }

  console.log(`Migration complete. Migrated ${migrated} wallets.`);
  process.exit(0);
}

if (require.main === module) {
  migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
