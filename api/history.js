const { cleanSymbol, fetchAlpha, json } = require('./_utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  try {
    const symbol = cleanSymbol(req.query.symbol);
    if (!symbol) return json(res, 400, { error: 'Missing symbol' });

    const data = await fetchAlpha({
      function: 'TIME_SERIES_DAILY_ADJUSTED',
      symbol,
      outputsize: 'compact',
    });
    const series = data['Time Series (Daily)'];
    if (!series) return json(res, 502, { error: 'No history returned' });

    const history = Object.keys(series)
      .sort()
      .slice(-90)
      .map((date) => ({ date, price: Number.parseFloat(series[date]['4. close']) }));
    json(res, 200, history);
  } catch (error) {
    json(res, 500, { error: error.message || 'Server error' });
  }
};
