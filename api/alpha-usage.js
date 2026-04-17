const { alphaUsage, json } = require('./_utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  json(res, 200, alphaUsage());
};
