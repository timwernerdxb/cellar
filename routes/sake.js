const router = require('express').Router();
const { authRequired } = require('../middleware/auth');

// Claude-powered sake spec lookup. Requires ANTHROPIC_API_KEY (server env);
// billed to the app owner, unlike the per-user OpenAI key used for label scans.
let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  const Anthropic = require('@anthropic-ai/sdk');
  // Bounded per-attempt timeout + single retry so a stuck upstream call fails
  // fast enough for the client to report it instead of hanging the UI.
  anthropic = new Anthropic({ timeout: 150000, maxRetries: 1 });
}

router.use(authRequired);

const enrichRateLimit = {}; // userId -> { count, resetAt }

// Look up verified polishing rates (seimaibuai) for up to 5 sake at a time.
// Uses web search so the answer comes from published product specs, not model memory.
router.post('/enrich', async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({ error: 'AI lookup not configured (ANTHROPIC_API_KEY missing on server)' });
  }

  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 5) : null;
  if (!items || items.length === 0) return res.status(400).json({ error: 'items array required' });

  // Rate limit: 120 item lookups per user per hour
  const now = Date.now();
  if (!enrichRateLimit[req.userId] || enrichRateLimit[req.userId].resetAt < now) {
    enrichRateLimit[req.userId] = { count: 0, resetAt: now + 3600000 };
  }
  if (enrichRateLimit[req.userId].count + items.length > 120) {
    return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
  }
  enrichRateLimit[req.userId].count += items.length;

  const list = items.map((it, i) => {
    const parts = ['name', 'producer', 'type', 'grape', 'region']
      .map(k => (typeof it?.[k] === 'string' ? it[k].slice(0, 120).trim() : null))
      .filter(Boolean);
    return `${i + 1}. ${parts.join(' | ')}`;
  }).join('\n');

  const prompt = `For each sake below, find its rice polishing ratio (seimaibuai) — the percentage of the rice grain remaining after milling (e.g. 50 means polished down to 50%).
Use web search to check the brewery's, importer's, or retailers' product pages and prefer the published specification. If the exact product cannot be verified, you may give a confident estimate for that brewery and grade; otherwise use null. Real products vary widely — do not default every item to the same number.

Sake to look up:
${list}

After your research, respond with ONLY a JSON array containing one object per item, in the same order:
[{"polishingRate": <number or null>, "source": "<domain the figure came from, or null>"}]`;

  const requestParams = {
    model: 'claude-opus-5',
    max_tokens: 16000,
    // Simple retrieval task — medium effort keeps latency reasonable
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: 'claude-opus-4-8' }],
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: Math.min(2 * items.length, 8) }],
  };

  try {
    let messages = [{ role: 'user', content: prompt }];
    let response = await anthropic.beta.messages.create({ ...requestParams, messages });

    // Server-side tools may pause the turn; resume until the model finishes
    let guard = 0;
    while (response.stop_reason === 'pause_turn' && guard++ < 5) {
      messages = [...messages, { role: 'assistant', content: response.content }];
      response = await anthropic.beta.messages.create({ ...requestParams, messages });
    }

    if (response.stop_reason === 'refusal') {
      return res.status(502).json({ error: 'AI declined the lookup' });
    }

    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const candidates = text.match(/\[\s*\{[\s\S]*?\}\s*\]/g) || [];
    let parsed = null;
    for (const candidate of candidates.reverse()) {
      try { parsed = JSON.parse(candidate); break; } catch { /* try earlier match */ }
    }
    if (!Array.isArray(parsed)) {
      console.error('Sake enrich: no JSON array in response:', text.slice(0, 300));
      return res.status(502).json({ error: 'Could not parse AI lookup result' });
    }

    res.json({
      results: items.map((_, i) => {
        const r = parsed[i] || {};
        const rate = (typeof r.polishingRate === 'number' && r.polishingRate >= 1 && r.polishingRate <= 99)
          ? Math.round(r.polishingRate) : null;
        return { polishingRate: rate, source: typeof r.source === 'string' ? r.source.slice(0, 200) : null };
      }),
    });
  } catch (err) {
    console.error('Sake enrich error:', err.message);
    res.status(502).json({ error: 'AI lookup failed: ' + String(err.message || err).slice(0, 200) });
  }
});

module.exports = router;
