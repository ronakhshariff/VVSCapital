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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const ALPHA_DAILY_LIMIT = Number(process.env.ALPHA_DAILY_LIMIT || 25);
const QUOTE_TTL_MS = Number(process.env.ALPHA_QUOTE_TTL_MS || 60 * 60 * 1000);
const HISTORY_TTL_MS = Number(process.env.ALPHA_HISTORY_TTL_MS || 12 * 60 * 60 * 1000);
const FX_TTL_MS = Number(process.env.FX_TTL_MS || 12 * 60 * 60 * 1000);
const ALPHA_STATE_PATH = path.join(ROOT, '.alpha-usage.json');

let alphaState = loadAlphaState();
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
  const symbol = (reqUrl.searchParams.get('symbol') || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
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

async function handleHistory(reqUrl, res) {
  const symbol = (reqUrl.searchParams.get('symbol') || '').toUpperCase().replace(/[^A-Z0-9.-]/g, '');
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
