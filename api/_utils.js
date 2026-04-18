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

function fmtCap(n) {
  if (!Number.isFinite(n)) return '-';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  return String(Math.round(n));
}

const ALPHA_DAILY_LIMIT = Number(process.env.ALPHA_DAILY_LIMIT || 25);
const QUOTE_TTL_MS = Number(process.env.ALPHA_QUOTE_TTL_MS || 60 * 60 * 1000);
const HISTORY_TTL_MS = Number(process.env.ALPHA_HISTORY_TTL_MS || 12 * 60 * 60 * 1000);
const FINNHUB_QUOTE_TTL_MS = Number(process.env.FINNHUB_QUOTE_TTL_MS || 15 * 60 * 1000);
const FINNHUB_HISTORY_TTL_MS = Number(process.env.FINNHUB_HISTORY_TTL_MS || 12 * 60 * 60 * 1000);
const FINNHUB_PROFILE_TTL_MS = Number(process.env.FINNHUB_PROFILE_TTL_MS || 24 * 60 * 60 * 1000);
const FX_TTL_MS = Number(process.env.FX_TTL_MS || 12 * 60 * 60 * 1000);

const state = globalThis.__vvsAlphaState || {
  day: null,
  count: 0,
  cache: new Map(),
};
globalThis.__vvsAlphaState = state;

const finnhubState = globalThis.__vvsFinnhubState || {
  cache: new Map(),
};
globalThis.__vvsFinnhubState = finnhubState;

const fxState = globalThis.__vvsFxState || {
  savedAt: 0,
  rate: 1.38,
  date: null,
  source: 'fallback',
};
globalThis.__vvsFxState = fxState;

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

function resetIfNeeded() {
  const today = dayKey();
  if (state.day !== today) {
    state.day = today;
    state.count = 0;
    state.cache.clear();
  }
}

function alphaUsage() {
  resetIfNeeded();
  return {
    day: state.day,
    used: state.count,
    limit: ALPHA_DAILY_LIMIT,
    remaining: Math.max(ALPHA_DAILY_LIMIT - state.count, 0),
    cacheEntries: state.cache.size,
    quoteTtlMinutes: Math.round(QUOTE_TTL_MS / 60000),
    historyTtlHours: Math.round(HISTORY_TTL_MS / 3600000),
  };
}

async function fetchAlpha(params) {
  const key = process.env.ALPHA_VANTAGE_KEY;
  if (!key) throw new Error('Missing ALPHA_VANTAGE_KEY');
  resetIfNeeded();

  const functionName = params.function || 'UNKNOWN';
  const ttl = functionName.includes('TIME_SERIES') ? HISTORY_TTL_MS : QUOTE_TTL_MS;
  const cacheKey = JSON.stringify(params);
  const cached = state.cache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < ttl) return cached.data;

  if (state.count >= ALPHA_DAILY_LIMIT) {
    if (cached) return cached.data;
    throw new Error(`Alpha Vantage daily request limit reached (${ALPHA_DAILY_LIMIT}).`);
  }

  const url = new URL('https://www.alphavantage.co/query');
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set('apikey', key);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Alpha Vantage request failed: ${response.status}`);
  const data = await response.json();
  if (data.Information || data.Note) {
    if (cached) return cached.data;
    throw new Error(data.Information || data.Note);
  }
  state.count += 1;
  state.cache.set(cacheKey, { savedAt: Date.now(), data });
  return data;
}

async function fetchFinnhub(endpoint, params, ttl = FINNHUB_QUOTE_TTL_MS) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error('Missing FINNHUB_API_KEY');
  const cacheKey = `${endpoint}:${JSON.stringify(params)}`;
  const cached = finnhubState.cache.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < ttl) return cached.data;

  const url = new URL(`https://finnhub.io/api/v1${endpoint}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set('token', key);

  const response = await fetch(url);
  if (!response.ok) {
    if (cached) return cached.data;
    throw new Error(`Finnhub request failed: ${response.status}`);
  }
  const data = await response.json();
  finnhubState.cache.set(cacheKey, { savedAt: Date.now(), data });
  return data;
}

async function usdCadRate() {
  if (Date.now() - fxState.savedAt < FX_TTL_MS) return fxState;
  const response = await fetch('https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1');
  if (!response.ok) return fxState;
  const data = await response.json();
  const observation = data.observations?.[0];
  const rate = Number.parseFloat(observation?.FXUSDCAD?.v);
  if (!Number.isFinite(rate)) return fxState;
  fxState.savedAt = Date.now();
  fxState.rate = rate;
  fxState.date = observation.d;
  fxState.source = 'Bank of Canada';
  return fxState;
}

module.exports = {
  FINNHUB_HISTORY_TTL_MS,
  FINNHUB_PROFILE_TTL_MS,
  FINNHUB_QUOTE_TTL_MS,
  alphaUsage,
  cleanSymbol,
  fetchAlpha,
  fetchFinnhub,
  fmtCap,
  fmtVol,
  json,
  usdCadRate,
};
