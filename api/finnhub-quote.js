const {
  FINNHUB_PROFILE_TTL_MS,
  FINNHUB_QUOTE_TTL_MS,
  cleanSymbol,
  fetchFinnhub,
  fmtCap,
  json,
} = require('./_utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  try {
    const symbol = cleanSymbol(req.query.symbol);
    if (!symbol) return json(res, 400, { error: 'Missing symbol' });

    const [quote, profile, metric] = await Promise.all([
      fetchFinnhub('/quote', { symbol }, FINNHUB_QUOTE_TTL_MS),
      fetchFinnhub('/stock/profile2', { symbol }, FINNHUB_PROFILE_TTL_MS).catch(() => ({})),
      fetchFinnhub('/stock/metric', { symbol, metric: 'all' }, FINNHUB_PROFILE_TTL_MS).catch(() => ({})),
    ]);

    const price = Number.parseFloat(quote.c);
    if (!Number.isFinite(price) || price <= 0) return json(res, 502, { error: 'No Finnhub quote returned' });

    const metrics = metric.metric || {};
    const change = Number.parseFloat(quote.d);
    const weekLow = Number.parseFloat(metrics['52WeekLow']);
    const weekHigh = Number.parseFloat(metrics['52WeekHigh']);
    const marketCap = Number.parseFloat(profile.marketCapitalization || metrics.marketCapitalization);
    const analyst = Number.parseFloat(metrics.ptMean);

    json(res, 200, {
      price,
      change: Number.isFinite(change) ? change : price - Number.parseFloat(quote.pc || price),
      pct: Number.parseFloat(quote.dp || 0),
      open: Number.parseFloat(quote.o || price),
      high: Number.parseFloat(quote.h || price),
      low: Number.parseFloat(quote.l || price),
      vol: '-',
      pe: Number.isFinite(Number.parseFloat(metrics.peNormalizedAnnual)) ? Number.parseFloat(metrics.peNormalizedAnnual).toFixed(1) : '-',
      beta: Number.isFinite(Number.parseFloat(metrics.beta)) ? Number.parseFloat(metrics.beta).toFixed(2) : '-',
      w52: Number.isFinite(weekLow) && Number.isFinite(weekHigh) ? `${weekLow.toFixed(2)} - ${weekHigh.toFixed(2)}` : '-',
      mktcap: fmtCap(Number.isFinite(marketCap) ? marketCap * 1e6 : NaN),
      analyst: Number.isFinite(analyst) ? analyst.toFixed(2) : '-',
      pos: Number.parseFloat(quote.d || 0) >= 0,
      name: profile.name || symbol,
      currency: profile.currency || 'USD',
      source: 'Finnhub',
    });
  } catch (error) {
    json(res, 500, { error: error.message || 'Server error' });
  }
};
