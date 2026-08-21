const { bot } = require('./lib/app');

bot.launch().then(() => console.log('Telegram bot polling started')).catch(err => { console.error(err); process.exit(1); });
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
