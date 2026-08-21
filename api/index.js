const { waitUntil } = require('@vercel/functions');
const app = require('../lib/renewals');
const { bot } = app;
const SECRET = process.env.WEBHOOK_SECRET || '';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });
  if (!SECRET || req.headers['x-telegram-bot-api-secret-token'] !== SECRET) {
    return res.status(401).json({ ok: false });
  }

  const update = req.body;
  waitUntil(
    Promise.resolve(bot.handleUpdate(update)).catch(error => {
      console.error(JSON.stringify({
        event: 'WEBHOOK_PROCESSING_ERROR',
        operation: error?.message || 'unknown'
      }));
    })
  );

  return res.status(200).json({ ok: true });
};
