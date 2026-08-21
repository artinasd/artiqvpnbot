const { waitUntil } = require('@vercel/functions');
const { bot } = require('../lib/app');

const SECRET = process.env.WEBHOOK_SECRET || '';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });
  if (SECRET && req.headers['x-telegram-bot-api-secret-token'] !== SECRET) return res.status(401).json({ ok: false });
  try {
    waitUntil(bot.handleUpdate(req.body));
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(JSON.stringify({ event: 'WEBHOOK_ERROR', operation: e?.message || 'unknown' }));
    return res.status(200).json({ ok: false });
  }
};
