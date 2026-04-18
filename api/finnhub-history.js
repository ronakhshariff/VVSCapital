const { FINNHUB_HISTORY_TTL_MS, cleanSymbol, fetchFinnhub, json } = require('./_utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  try {
    const symbol = cleanSymbol(req.query.symbol);
    if (!symbol) return json(res, 400, { error: 'Missing symbol' });

    const to = Math.floor(Date.now() / 1000);
    const from = to - 120 * 24 * 60 * 60;
    const data = await fetchFinnhub('/stock/candle', { symbol, resolution: 'D', from, to }, FINNHUB_HISTORY_TTL_MS);
    if (data.s !== 'ok' || !Array.isArray(data.t)) return json(res, 502, { error: 'No Finnhub history returned' });

    const times = data.t.slice(-90);
    const closes = data.c.slice(-90);
    const history = times.map((time, index) => ({
      date: new Date(time * 1000).toISOString().slice(0, 10),
      price: Number.parseFloat(closes[index]),
    }));
    json(res, 200, history);
  } catch (error) {
    json(res, 500, { error: error.message || 'Server error' });
  }
};
