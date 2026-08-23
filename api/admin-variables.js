const { listVariables } = require('../lib/bot-variables');

const PASSWORD = process.env.ADMIN_CMS_PASSWORD || '';

module.exports = function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
  }

  if (!PASSWORD || req.headers['x-admin-password'] !== PASSWORD) {
    res.status(401).setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'UNAUTHORIZED' }));
  }

  res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify({ variables: listVariables() }));
};
