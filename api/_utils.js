function json(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(data));
}

function cleanSymbol(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
}

function fmtVol(n) {
  if (!Number.isFinite(n)) return '-';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

async function fetchAlpha(params) {
  const key = process.env.ALPHA_VANTAGE_KEY;
  if (!key) throw new Error('Missing ALPHA_VANTAGE_KEY');

  const url = new URL('https://www.alphavantage.co/query');
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set('apikey', key);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Alpha Vantage request failed: ${response.status}`);
  return response.json();
}

module.exports = { cleanSymbol, fetchAlpha, fmtVol, json };
