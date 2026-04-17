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
GEMINI_API_KEY
GEMINI_MODEL=gemini-2.5-flash-lite
```

Then deploy the project from GitHub or with the Vercel CLI.

The frontend calls `/api/quote`, `/api/history`, and `/api/gemini`, so the same `index.html` works locally and on Vercel.
