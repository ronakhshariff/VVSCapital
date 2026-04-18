const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, '.env');

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_KEY;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const ALPHA_DAILY_LIMIT = Number(process.env.ALPHA_DAILY_LIMIT || 25);
const QUOTE_TTL_MS = Number(process.env.ALPHA_QUOTE_TTL_MS || 60 * 60 * 1000);
const HISTORY_TTL_MS = Number(process.env.ALPHA_HISTORY_TTL_MS || 12 * 60 * 60 * 1000);
const FINNHUB_QUOTE_TTL_MS = Number(process.env.FINNHUB_QUOTE_TTL_MS || 15 * 60 * 1000);
const FINNHUB_HISTORY_TTL_MS = Number(process.env.FINNHUB_HISTORY_TTL_MS || 12 * 60 * 60 * 1000);
const FINNHUB_PROFILE_TTL_MS = Number(process.env.FINNHUB_PROFILE_TTL_MS || 24 * 60 * 60 * 1000);
const FX_TTL_MS = Number(process.env.FX_TTL_MS || 12 * 60 * 60 * 1000);
const ALPHA_STATE_PATH = path.join(ROOT, '.alpha-usage.json');

let alphaState = loadAlphaState();
let finnhubState = { cache: {} };
let fxState = { savedAt: 0, rate: 1.38, date: null, source: 'fallback' };

function loadAlphaState() {
  try {
    if (!fs.existsSync(ALPHA_STATE_PATH)) return { day: null, count: 0, cache: {} };
    const parsed = JSON.parse(fs.readFileSync(ALPHA_STATE_PATH, 'utf8'));
    return { day: parsed.day || null, count: Number(parsed.count || 0), cache: parsed.cache || {} };
  } catch {
    return { day: null, count: 0, cache: {} };
  }
}

function saveAlphaState() {
  fs.writeFileSync(ALPHA_STATE_PATH, JSON.stringify(alphaState, null, 2));
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function fmtVol(n) {
  if (!Number.isFinite(n)) return '-';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function fmtCap(n) {
  if (!Number.isFinite(n)) return '-';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  return String(Math.round(n));
}

function cleanSymbol(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
}

function requireKeys() {
  if (!ALPHA_VANTAGE_KEY) throw new Error('Missing ALPHA_VANTAGE_KEY in .env');
  if (!GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY in .env');
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function resetAlphaIfNeeded() {
  const today = dayKey();
  if (alphaState.day !== today) {
    alphaState = { day: today, count: 0, cache: {} };
    saveAlphaState();
  }
}

function alphaUsage() {
  resetAlphaIfNeeded();
  return {
    day: alphaState.day,
    used: alphaState.count,
    limit: ALPHA_DAILY_LIMIT,
    remaining: Math.max(ALPHA_DAILY_LIMIT - alphaState.count, 0),
    cacheEntries: Object.keys(alphaState.cache).length,
    quoteTtlMinutes: Math.round(QUOTE_TTL_MS / 60000),
    historyTtlHours: Math.round(HISTORY_TTL_MS / 3600000),
  };
}

async function fetchAlpha(params) {
  if (!ALPHA_VANTAGE_KEY) throw new Error('Missing ALPHA_VANTAGE_KEY in .env');
  resetAlphaIfNeeded();

  const functionName = params.function || 'UNKNOWN';
  const ttl = functionName.includes('TIME_SERIES') ? HISTORY_TTL_MS : QUOTE_TTL_MS;
  const cacheKey = JSON.stringify(params);
  const cached = alphaState.cache[cacheKey];
  if (cached && Date.now() - cached.savedAt < ttl) return cached.data;

  if (alphaState.count >= ALPHA_DAILY_LIMIT) {
    if (cached) return cached.data;
    throw new Error(`Alpha Vantage daily request limit reached (${ALPHA_DAILY_LIMIT}).`);
  }

  const url = new URL('https://www.alphavantage.co/query');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('apikey', ALPHA_VANTAGE_KEY);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Alpha Vantage request failed: ${response.status}`);
  const data = await response.json();
  if (data.Information || data.Note) {
    if (cached) return cached.data;
    throw new Error(data.Information || data.Note);
  }
  alphaState.count += 1;
  alphaState.cache[cacheKey] = { savedAt: Date.now(), data };
  saveAlphaState();
  return data;
}

async function fetchFinnhub(endpoint, params, ttl = FINNHUB_QUOTE_TTL_MS) {
  if (!FINNHUB_API_KEY) throw new Error('Missing FINNHUB_API_KEY in .env');
  const cacheKey = `${endpoint}:${JSON.stringify(params)}`;
  const cached = finnhubState.cache[cacheKey];
  if (cached && Date.now() - cached.savedAt < ttl) return cached.data;

  const url = new URL(`https://finnhub.io/api/v1${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('token', FINNHUB_API_KEY);

  const response = await fetch(url);
  if (!response.ok) {
    if (cached) return cached.data;
    throw new Error(`Finnhub request failed: ${response.status}`);
  }
  const data = await response.json();
  finnhubState.cache[cacheKey] = { savedAt: Date.now(), data };
  return data;
}

async function fetchUsdCad() {
  if (Date.now() - fxState.savedAt < FX_TTL_MS) return fxState;
  const response = await fetch('https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1');
  if (!response.ok) return fxState;
  const data = await response.json();
  const observation = data.observations?.[0];
  const rate = Number.parseFloat(observation?.FXUSDCAD?.v);
  if (!Number.isFinite(rate)) return fxState;
  fxState = { savedAt: Date.now(), rate, date: observation.d, source: 'Bank of Canada' };
  return fxState;
}

async function handleQuote(reqUrl, res) {
  const symbol = cleanSymbol(reqUrl.searchParams.get('symbol'));
  if (!symbol) return sendJson(res, 400, { error: 'Missing symbol' });

  const json = await fetchAlpha({ function: 'GLOBAL_QUOTE', symbol });
  const q = json['Global Quote'];
  if (!q || !q['05. price']) return sendJson(res, 502, { error: 'No quote returned' });

  const price = Number.parseFloat(q['05. price']);
  const change = Number.parseFloat(q['09. change']);
  const pct = Number.parseFloat(String(q['10. change percent'] || '0').replace('%', ''));
  sendJson(res, 200, {
    price,
    change,
    pct,
    open: Number.parseFloat(q['02. open']),
    high: Number.parseFloat(q['03. high']),
    low: Number.parseFloat(q['04. low']),
    vol: fmtVol(Number.parseInt(q['06. volume'], 10)),
    pe: '-',
    beta: '-',
    w52: '-',
    mktcap: '-',
    analyst: '-',
    pos: change >= 0,
  });
}

async function handleFinnhubQuote(reqUrl, res) {
  const symbol = cleanSymbol(reqUrl.searchParams.get('symbol'));
  if (!symbol) return sendJson(res, 400, { error: 'Missing symbol' });

  const [quote, profile, metric] = await Promise.all([
    fetchFinnhub('/quote', { symbol }, FINNHUB_QUOTE_TTL_MS),
    fetchFinnhub('/stock/profile2', { symbol }, FINNHUB_PROFILE_TTL_MS).catch(() => ({})),
    fetchFinnhub('/stock/metric', { symbol, metric: 'all' }, FINNHUB_PROFILE_TTL_MS).catch(() => ({})),
  ]);

  const price = Number.parseFloat(quote.c);
  if (!Number.isFinite(price) || price <= 0) return sendJson(res, 502, { error: 'No Finnhub quote returned' });

  const change = Number.parseFloat(quote.d);
  const metrics = metric.metric || {};
  const weekLow = Number.parseFloat(metrics['52WeekLow']);
  const weekHigh = Number.parseFloat(metrics['52WeekHigh']);
  const marketCap = Number.parseFloat(profile.marketCapitalization || metrics.marketCapitalization);
  const analyst = Number.parseFloat(metrics.ptMean);

  sendJson(res, 200, {
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
}

async function handleHistory(reqUrl, res) {
  const symbol = cleanSymbol(reqUrl.searchParams.get('symbol'));
  if (!symbol) return sendJson(res, 400, { error: 'Missing symbol' });

  const json = await fetchAlpha({
    function: 'TIME_SERIES_DAILY_ADJUSTED',
    symbol,
    outputsize: 'compact',
  });
  const ts = json['Time Series (Daily)'];
  if (!ts) return sendJson(res, 502, { error: 'No history returned' });

  const data = Object.keys(ts)
    .sort()
    .slice(-90)
    .map((date) => ({ date, price: Number.parseFloat(ts[date]['4. close']) }));
  sendJson(res, 200, data);
}

async function handleFinnhubHistory(reqUrl, res) {
  const symbol = cleanSymbol(reqUrl.searchParams.get('symbol'));
  if (!symbol) return sendJson(res, 400, { error: 'Missing symbol' });

  const to = Math.floor(Date.now() / 1000);
  const from = to - 120 * 24 * 60 * 60;
  const data = await fetchFinnhub('/stock/candle', { symbol, resolution: 'D', from, to }, FINNHUB_HISTORY_TTL_MS);
  if (data.s !== 'ok' || !Array.isArray(data.t)) return sendJson(res, 502, { error: 'No Finnhub history returned' });

  const times = data.t.slice(-90);
  const closes = data.c.slice(-90);
  const history = times.map((time, index) => ({
    date: new Date(time * 1000).toISOString().slice(0, 10),
    price: Number.parseFloat(closes[index]),
  }));
  sendJson(res, 200, history);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function handleGemini(req, res) {
  if (!GEMINI_API_KEY) return sendJson(res, 500, { error: 'Missing GEMINI_API_KEY in .env' });
  const body = JSON.parse((await readBody(req)) || '{}');
  const prompt = String(body.prompt || '').trim();
  const maxTokens = Math.min(Math.max(Number(body.maxTokens || 800), 1), 1200);
  if (!prompt) return sendJson(res, 400, { error: 'Missing prompt' });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.35 },
      }),
    }
  );
  const json = await response.json();
  if (!response.ok) return sendJson(res, response.status, { error: json.error?.message || 'Gemini request failed' });
  const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  sendJson(res, 200, { text });
}

function serveIndex(res) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  sendText(res, 200, html, 'text/html; charset=utf-8');
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') return serveIndex(res);
    if (reqUrl.pathname === '/api/quote' && req.method === 'GET') return await handleQuote(reqUrl, res);
    if (reqUrl.pathname === '/api/history' && req.method === 'GET') return await handleHistory(reqUrl, res);
    if (reqUrl.pathname === '/api/finnhub-quote' && req.method === 'GET') return await handleFinnhubQuote(reqUrl, res);
    if (reqUrl.pathname === '/api/finnhub-history' && req.method === 'GET') return await handleFinnhubHistory(reqUrl, res);
    if (reqUrl.pathname === '/api/gemini' && req.method === 'POST') return await handleGemini(req, res);
    if (reqUrl.pathname === '/api/fx' && req.method === 'GET') return sendJson(res, 200, await fetchUsdCad());
    if (reqUrl.pathname === '/api/alpha-usage' && req.method === 'GET') return sendJson(res, 200, alphaUsage());
    if (reqUrl.pathname === '/api/health') {
      requireKeys();
      return sendJson(res, 200, { ok: true, model: GEMINI_MODEL });
    }
    sendText(res, 404, 'Not found');
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`VVS Capital running at http://localhost:${PORT}`);
  console.log(`On your mobile, open http://192.168.1.81:${PORT} while on the same Wi-Fi.`);
});
