const { isAuthorizedAdmin, sendJson } = require('../lib/cms-auth');
const { listVariables } = require('../lib/bot-variables');

module.exports = function handler(req, res) {
  if (!isAuthorizedAdmin(req)) return sendJson(res, 401, { error: 'UNAUTHORIZED' });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  }
  return sendJson(res, 200, { variables: listVariables() });
};
