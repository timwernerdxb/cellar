const router = require('express').Router();
const { authRequired } = require('../middleware/auth');

// Claude-powered sake spec lookup. Requires ANTHROPIC_API_KEY (server env);
// billed to the app owner, unlike the per-user OpenAI key used for label scans.
let anthropic = null;
if (process.env.ANTHROPIC_API_KEY) {
  const Anthropic = require('@anthropic-ai/sdk');
  // Bounded per-attempt timeout + single retry so a stuck upstream call fails
  // fast enough to be reported instead of hanging.
  anthropic = new Anthropic({ timeout: 150000, maxRetries: 1 });
}

const SAKE_TYPES = ['Junmai', 'Ginjo', 'Daiginjo', 'Nigori', 'Sparkling Sake', 'Sake'];
const isSakeRecord = d => d && (d.category === 'sake' || SAKE_TYPES.includes(d.type));
// Same rule as the client: look up missing rates and stale AI guesses; never
// touch manual entries (auto === false) or already web-verified values.
const needsLookup = d => isSakeRecord(d) && d.name &&
  (!d.polishingRate || (d.polishingRateAuto !== false && !d.polishingRateVerified));

// Core lookup: verified polishing rates for up to 5 sake. Returns aligned
// [{polishingRate, source}]. Throws on API failure.
async function lookupRates(items) {
  const list = items.map((it, i) => {
    const parts = ['name', 'producer', 'type', 'grape', 'region']
      .map(k => (typeof it?.[k] === 'string' ? it[k].slice(0, 120).trim() : null))
      .filter(Boolean);
    return `${i + 1}. ${parts.join(' | ')}`;
  }).join('\n');

  const prompt = `For each sake below, find its rice polishing ratio (seimaibuai) — the percentage of the rice grain remaining after milling (e.g. 50 means polished down to 50%).
Use web search to check the brewery's, importer's, or retailers' product pages and prefer the published specification. The grade/type listed for an item may be wrong or incomplete (e.g. a Junmai Daiginjo recorded as just "Junmai") — verify the product's actual classification online and report the true published seimaibuai, never a value merely typical for the listed grade. If the exact product cannot be verified, estimate from the brewery's actual classification and practice; otherwise use null. Real products vary widely — do not default every item to the same number.

Sake to look up:
${list}

Also report each product's ABV percentage when the product page states it.

After your research, respond with ONLY a JSON array containing one object per item, in the same order:
[{"polishingRate": <number or null>, "abv": <number or null>, "source": "<domain the figures came from, or null>"}]`;

  const requestParams = {
    model: 'claude-opus-5',
    max_tokens: 16000,
    // Simple retrieval task — medium effort keeps latency reasonable
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-06-01'],
    fallbacks: [{ model: 'claude-opus-4-8' }],
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: Math.min(2 * items.length, 8) }],
  };

  let messages = [{ role: 'user', content: prompt }];
  let response = await anthropic.beta.messages.create({ ...requestParams, messages });

  // Server-side tools may pause the turn; resume until the model finishes
  let guard = 0;
  while (response.stop_reason === 'pause_turn' && guard++ < 5) {
    messages = [...messages, { role: 'assistant', content: response.content }];
    response = await anthropic.beta.messages.create({ ...requestParams, messages });
  }

  if (response.stop_reason === 'refusal') throw new Error('AI declined the lookup');

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const candidates = text.match(/\[\s*\{[\s\S]*?\}\s*\]/g) || [];
  let parsed = null;
  for (const candidate of candidates.reverse()) {
    try { parsed = JSON.parse(candidate); break; } catch { /* try earlier match */ }
  }
  if (!Array.isArray(parsed)) {
    console.error('Sake lookup: no JSON array in response:', text.slice(0, 300));
    throw new Error('Could not parse AI lookup result');
  }

  return items.map((_, i) => {
    const r = parsed[i] || {};
    const rate = (typeof r.polishingRate === 'number' && r.polishingRate >= 1 && r.polishingRate <= 99)
      ? Math.round(r.polishingRate) : null;
    const abv = (typeof r.abv === 'number' && r.abv >= 1 && r.abv <= 75)
      ? Math.round(r.abv * 10) / 10 : null;
    return { polishingRate: rate, abv, source: typeof r.source === 'string' ? r.source.slice(0, 200) : null };
  });
}

router.use(authRequired);

const enrichRateLimit = {}; // userId -> { count, resetAt }

// Synchronous lookup for a handful of items — used by the per-bottle
// re-check links and post-scan verification.
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

  try {
    res.json({ results: await lookupRates(items) });
  } catch (err) {
    console.error('Sake enrich error:', err.message);
    res.status(502).json({ error: 'AI lookup failed: ' + String(err.message || err).slice(0, 200) });
  }
});

// ---- Background backfill job ----
// The whole backfill runs server-side against the user's synced data, so the
// phone doesn't have to hold a connection open (iOS Safari kills long fetches).

const jobs = {}; // userId -> { running, done, total, processed, filled, error, startedAt }

router.post('/backfill/start', async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({ error: 'AI lookup not configured (ANTHROPIC_API_KEY missing on server)' });
  }
  const existing = jobs[req.userId];
  if (existing && existing.running) {
    return res.json({ ok: true, alreadyRunning: true, total: existing.total });
  }

  const pool = req.app.locals.pool;
  try {
    const demo = await pool.query('SELECT is_demo FROM users WHERE id = $1', [req.userId]);
    if (demo.rows[0]?.is_demo) return res.status(403).json({ error: 'Not available in the demo account' });

    const targets = [];
    for (const table of ['bottles', 'finds']) {
      const result = await pool.query(`SELECT id, data FROM ${table} WHERE user_id = $1`, [req.userId]);
      for (const row of result.rows) {
        if (needsLookup(row.data)) targets.push({ table, id: row.id, data: row.data });
      }
    }
    const capped = targets.slice(0, 200);
    if (capped.length === 0) return res.json({ ok: true, total: 0, done: true });

    const job = jobs[req.userId] = {
      running: true, done: false, total: capped.length, processed: 0, filled: 0, error: null, startedAt: Date.now(),
    };
    runBackfillJob(pool, req.userId, capped, job).catch(err => {
      console.error('Backfill job crashed:', err);
      job.error = String(err.message || err).slice(0, 200);
      job.running = false;
      job.done = true;
    });
    res.json({ ok: true, total: capped.length });
  } catch (err) {
    console.error('Backfill start error:', err.message);
    res.status(500).json({ error: 'Could not start backfill' });
  }
});

router.get('/backfill/status', (req, res) => {
  const job = jobs[req.userId];
  if (!job) return res.json({ none: true, running: false, done: false });
  res.json({
    running: job.running, done: job.done, total: job.total,
    processed: job.processed, filled: job.filled, error: job.error,
    elapsedSeconds: Math.round((Date.now() - job.startedAt) / 1000),
  });
});

async function runBackfillJob(pool, userId, targets, job) {
  const batchSize = 3;
  const batches = [];
  for (let i = 0; i < targets.length; i += batchSize) batches.push(targets.slice(i, i + batchSize));

  let failures = 0;
  let nextBatch = 0;

  const worker = async () => {
    while (failures < 3) {
      const index = nextBatch++;
      if (index >= batches.length) return;
      const batch = batches[index];
      const payload = batch.map(t => ({
        name: t.data.name, producer: t.data.producer, type: t.data.type, grape: t.data.grape, region: t.data.region,
      }));

      let results = null;
      try {
        results = await lookupRates(payload);
      } catch (err) {
        try {
          await new Promise(r => setTimeout(r, 2000));
          results = await lookupRates(payload);
        } catch (err2) {
          failures++;
          console.error(`Backfill batch ${index + 1} failed:`, err2.message);
        }
      }

      if (results) {
        for (let k = 0; k < batch.length; k++) {
          const rate = results[k] && results[k].polishingRate;
          if (!rate) continue;
          const t = batch[k];
          // Merge-patch the JSONB so concurrent client edits to other fields survive
          const fields = { polishingRate: rate, polishingRateAuto: true, polishingRateVerified: true };
          // Fill ABV as a bonus, but never overwrite an existing value
          if (results[k].abv && !t.data.abv) fields.abv = results[k].abv;
          await pool.query(
            `UPDATE ${t.table} SET data = data || $1::jsonb, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
            [JSON.stringify(fields), t.id, userId]
          );
          job.filled++;
        }
      }

      job.processed += batch.length;
    }
  };

  // Two batches in flight at once — halves wall-clock time
  await Promise.all([worker(), worker()]);

  if (failures >= 3) job.error = 'Stopped after repeated lookup failures';
  job.running = false;
  job.done = true;
}

module.exports = router;
