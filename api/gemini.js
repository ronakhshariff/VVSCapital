const { json } = require('./_utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  try {
    const key = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
    if (!key) return json(res, 500, { error: 'Missing GEMINI_API_KEY' });

    const prompt = String(req.body?.prompt || '').trim();
    const maxTokens = Math.min(Math.max(Number(req.body?.maxTokens || 800), 1), 1200);
    if (!prompt) return json(res, 400, { error: 'Missing prompt' });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.35 },
        }),
      }
    );
    const data = await response.json();
    if (!response.ok) return json(res, response.status, { error: data.error?.message || 'Gemini request failed' });

    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
    json(res, 200, { text });
  } catch (error) {
    json(res, 500, { error: error.message || 'Server error' });
  }
};
