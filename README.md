# VVS Capital

Local and Vercel-ready market intelligence dashboard.

## Local

```bash
node server.js
```

Open `http://localhost:3000`.

## Vercel

Add these environment variables in Vercel Project Settings:

```text
ALPHA_VANTAGE_KEY
FINNHUB_API_KEY
GEMINI_API_KEY
GEMINI_MODEL=gemini-2.5-flash-lite
```

Then deploy the project from GitHub or with the Vercel CLI.

The curated VVS watchlist uses Alpha Vantage. Browser-added local tickers are saved in `localStorage` and use the backend Finnhub routes when `FINNHUB_API_KEY` is configured.

The frontend calls `/api/quote`, `/api/history`, `/api/finnhub-quote`, `/api/finnhub-history`, and `/api/gemini`, so the same `index.html` works locally and on Vercel.
