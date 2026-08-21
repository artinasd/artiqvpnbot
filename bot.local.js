require('./lib/renewals').bot.launch().then(() => console.log('Telegram bot polling started')).catch(err => { console.error(err); process.exit(1); });
const { bot } = require('./lib/renewals');
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
