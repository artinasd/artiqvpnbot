/*
 * Production is serverless: api/index.js is the single Telegram webhook entrypoint.
 *
 * This file intentionally no longer contains a second/manual sales workflow. The old
 * implementation could approve receipts and manually paste VPN configs, which would
 * bypass the automated PasarGuard order system.
 *
 * For local development, deploy the same api/index.js handler behind a local HTTPS
 * tunnel and configure Telegram's webhook to that URL. Production should use Vercel.
 */
console.log('ArtiQ VPN production entrypoint: api/index.js');
console.log('Use Vercel + Telegram webhook for the automated PasarGuard workflow.');
