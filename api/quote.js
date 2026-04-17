const { cleanSymbol, fetchAlpha, fmtVol, json } = require('./_utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  try {
    const symbol = cleanSymbol(req.query.symbol);
    if (!symbol) return json(res, 400, { error: 'Missing symbol' });

    const data = await fetchAlpha({ function: 'GLOBAL_QUOTE', symbol });
    const quote = data['Global Quote'];
    if (!quote || !quote['05. price']) return json(res, 502, { error: 'No quote returned' });

    const change = Number.parseFloat(quote['09. change']);
    json(res, 200, {
      price: Number.parseFloat(quote['05. price']),
      change,
      pct: Number.parseFloat(String(quote['10. change percent'] || '0').replace('%', '')),
      open: Number.parseFloat(quote['02. open']),
      high: Number.parseFloat(quote['03. high']),
      low: Number.parseFloat(quote['04. low']),
      vol: fmtVol(Number.parseInt(quote['06. volume'], 10)),
      pe: '-',
      beta: '-',
      w52: '-',
      mktcap: '-',
      analyst: '-',
      pos: change >= 0,
    });
  } catch (error) {
    json(res, 500, { error: error.message || 'Server error' });
  }
};
