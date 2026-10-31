const crypto = require('crypto');
const { Telegraf } = require('telegraf');
const { processPendingPurchaseReports } = require('../lib/purchase-report');

function isAuthorized(authorization, secret) {
  if (!secret || typeof authorization !== 'string') return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorization);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = async function purchaseReportsWorker(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  const secret = process.env.PURCHASE_REPORT_CRON_SECRET || '';
  if (!isAuthorized(req.headers?.authorization, secret)) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  const token = process.env.BOT_TOKEN || '';
  if (!token) return res.status(503).json({ ok: false, error: 'BOT_TOKEN_NOT_CONFIGURED' });
  try {
    const telegram = new Telegraf(token).telegram;
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit) || 25));
    const result = await processPendingPurchaseReports(telegram, { limit });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[PURCHASE_REPORT_WORKER_FAILED]', error?.message || String(error));
    return res.status(500).json({ ok: false, error: 'WORKER_FAILED' });
  }
};

module.exports.isAuthorized = isAuthorized;
