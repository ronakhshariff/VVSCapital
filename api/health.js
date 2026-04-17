const { json } = require('./_utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (!process.env.ALPHA_VANTAGE_KEY) return json(res, 500, { error: 'Missing ALPHA_VANTAGE_KEY' });
  if (!process.env.GEMINI_API_KEY) return json(res, 500, { error: 'Missing GEMINI_API_KEY' });
  json(res, 200, { ok: true, model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite' });
};
