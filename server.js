require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Database pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
});
app.locals.pool = pool;

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err.message);
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '20mb' }));
app.use(cookieParser());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Auto-run migrations on startup
const fs = require('fs');
(async () => {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('Database schema applied.');
  } catch (err) {
    console.error('Schema migration warning:', err.message);
  }
})();

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Demo account configuration
const DEMO_EMAIL = 'test@test.com';
const DEMO_PASSWORD = '123456';
const DEMO_OPENAI_KEY = process.env.DEMO_OPENAI_KEY || '';

// Seed demo account: POST /api/seed-demo (idempotent — safe to call multiple times)
const bcryptSeed = require('bcryptjs');
app.post('/api/seed-demo', async (req, res) => {
  try {
    // Find source user (Tim — the main account, first non-demo user with bottles)
    const sourceUser = await pool.query(
      `SELECT id FROM users WHERE is_demo IS NOT TRUE AND email != $1
       ORDER BY created_at ASC LIMIT 1`, [DEMO_EMAIL]
    );
    if (sourceUser.rows.length === 0) return res.status(404).json({ error: 'No source user found' });
    const sourceId = sourceUser.rows[0].id;

    // Check if demo user already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [DEMO_EMAIL]);
    let demoId;

    if (existing.rows.length > 0) {
      demoId = existing.rows[0].id;
      // Update password + key + flag
      const hash = await bcryptSeed.hash(DEMO_PASSWORD, 12);
      await pool.query(
        `UPDATE users SET password_hash = $1, openai_key = $2, is_demo = true, name = 'Demo', updated_at = NOW() WHERE id = $3`,
        [hash, DEMO_OPENAI_KEY, demoId]
      );
    } else {
      // Create demo user
      const hash = await bcryptSeed.hash(DEMO_PASSWORD, 12);
      const result = await pool.query(
        `INSERT INTO users (email, password_hash, name, openai_key, is_demo)
         VALUES ($1, $2, 'Demo', $3, true) RETURNING id`,
        [DEMO_EMAIL, hash, DEMO_OPENAI_KEY]
      );
      demoId = result.rows[0].id;
    }

    // Copy portfolio data from source user
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Clear existing demo data
      await client.query('DELETE FROM bottles WHERE user_id = $1', [demoId]);
      await client.query('DELETE FROM tastings WHERE user_id = $1', [demoId]);
      await client.query('DELETE FROM finds WHERE user_id = $1', [demoId]);

      // Copy bottles
      await client.query(
        `INSERT INTO bottles (id, user_id, data, updated_at)
         SELECT id, $1, data, NOW() FROM bottles WHERE user_id = $2`,
        [demoId, sourceId]
      );

      // Copy tastings
      await client.query(
        `INSERT INTO tastings (id, user_id, data, updated_at)
         SELECT id, $1, data, NOW() FROM tastings WHERE user_id = $2`,
        [demoId, sourceId]
      );

      // Copy finds
      await client.query(
        `INSERT INTO finds (id, user_id, data, updated_at)
         SELECT id, $1, data, NOW() FROM finds WHERE user_id = $2`,
        [demoId, sourceId]
      );

      // Generate share link for demo account
      const crypto = require('crypto');
      const shareToken = crypto.randomUUID();
      await client.query(
        `UPDATE users SET share_token = $1, share_show_values = true WHERE id = $2`,
        [shareToken, demoId]
      );

      await client.query('COMMIT');

      const bottleCount = await pool.query('SELECT count(*) FROM bottles WHERE user_id = $1', [demoId]);
      const findCount = await pool.query('SELECT count(*) FROM finds WHERE user_id = $1', [demoId]);

      res.json({
        ok: true,
        demoId,
        email: DEMO_EMAIL,
        bottles: parseInt(bottleCount.rows[0].count),
        finds: parseInt(findCount.rows[0].count),
        shareToken,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Seed demo error:', err);
    res.status(500).json({ error: err.message });
  }
});

// One-time data fixes
app.post('/api/data-fix', async (req, res) => {
  try {
    const fixes = [];

    // Fix 1: Dom Perignon 2004 — update consumption date to March 2, 2023
    const dpResult = await pool.query(
      `SELECT id, user_id, data FROM bottles WHERE data->>'name' ILIKE '%Dom P_rignon%' AND data->>'vintage' = '2004'`
    );
    for (const row of dpResult.rows) {
      const data = row.data;
      // Update consumption history dates
      if (data.consumptionHistory && data.consumptionHistory.length > 0) {
        data.consumptionHistory = data.consumptionHistory.map(entry => {
          entry.date = '2023-03-02';
          return entry;
        });
      }
      // Also set consumedDate if present
      if (data.consumedDate) data.consumedDate = '2023-03-02';
      await pool.query(
        'UPDATE bottles SET data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
        [JSON.stringify(data), row.id, row.user_id]
      );
      fixes.push('Dom Perignon 2004: consumption date → 2023-03-02');
    }

    // Fix 2: Angelica Zapata find — update image, date, location
    const azResult = await pool.query(
      `SELECT id, user_id, data FROM finds WHERE data->>'name' ILIKE '%Angelica Zapata%' OR data->>'name' ILIKE '%Angélica Zapata%'`
    );
    for (const row of azResult.rows) {
      const data = row.data;
      data.imageUrl = 'https://www.wine-window.com/cdn/shop/files/web_angelica_zapata.png?v=1733856247';
      data.imageBlurred = false;
      data.imageCropped = false;
      data.foundDate = '2024-12-10';
      data.date = '2024-12-10';
      data.restaurantName = 'São Paulo, BR';
      data.venue = 'São Paulo, BR';
      data.city = 'São Paulo';
      data.country = 'BR';
      await pool.query(
        'UPDATE finds SET data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
        [JSON.stringify(data), row.id, row.user_id]
      );
      fixes.push('Angelica Zapata: image + date (2024-12-10) + location (São Paulo, BR)');
    }

    // Fix 3: Clase Azul Día de Muertos Recuerdos — replace over-cropped image with fresh one
    const caResult = await pool.query(
      `SELECT id, user_id, data FROM bottles WHERE data->>'name' ILIKE '%Clase Azul%Recuerdos%' OR data->>'name' ILIKE '%Clase Azul%Muertos%Recuerdos%'`
    );
    for (const row of caResult.rows) {
      const data = row.data;
      data.imageUrl = 'https://woodencork.com/cdn/shop/files/clase-azul-tequila-dia-de-los-muertos-limited-edition-recuerdos-2025-930.webp?v=1760488950';
      data.imageBlurred = false;
      data.imageCropped = false;
      await pool.query(
        'UPDATE bottles SET data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
        [JSON.stringify(data), row.id, row.user_id]
      );
      fixes.push('Clase Azul Dia de Muertos Recuerdos: fresh image restored');
    }

    // Fix 4: Reset crop AND blur flags so images can be reprocessed
    const resetResult = await pool.query(
      `SELECT id, user_id, data FROM bottles WHERE data->>'imageCropped' = 'true' OR data->>'imageBlurred' = 'true'`
    );
    let resetCount = 0;
    for (const row of resetResult.rows) {
      const data = row.data;
      data.imageCropped = false;
      data.imageBlurred = false;
      await pool.query(
        'UPDATE bottles SET data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
        [JSON.stringify(data), row.id, row.user_id]
      );
      resetCount++;
    }
    const resetFindsResult = await pool.query(
      `SELECT id, user_id, data FROM finds WHERE data->>'imageCropped' = 'true' OR data->>'imageBlurred' = 'true'`
    );
    for (const row of resetFindsResult.rows) {
      const data = row.data;
      data.imageCropped = false;
      data.imageBlurred = false;
      await pool.query(
        'UPDATE finds SET data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
        [JSON.stringify(data), row.id, row.user_id]
      );
      resetCount++;
    }
    if (resetCount > 0) fixes.push(`Reset crop+blur flags on ${resetCount} items`);

    res.json({ ok: true, fixes });
  } catch (err) {
    console.error('Data fix error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bottles', require('./routes/bottles'));
app.use('/api/tastings', require('./routes/tastings'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/images', require('./routes/images'));
app.use('/api/share', require('./routes/share'));

// Serve bottle image for share page (public, validated by share token)
app.get('/share/:token/image/:bottleId', async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT id FROM users WHERE share_token = $1', [req.params.token]
    );
    if (userResult.rows.length === 0) return res.status(404).send('Not found');
    const userId = userResult.rows[0].id;
    // Check bottles first, then finds
    let bottleResult = await pool.query(
      "SELECT data->>'imageUrl' AS image_url FROM bottles WHERE id = $1 AND user_id = $2",
      [req.params.bottleId, userId]
    );
    if (bottleResult.rows.length === 0 || !bottleResult.rows[0].image_url) {
      bottleResult = await pool.query(
        "SELECT data->>'imageUrl' AS image_url FROM finds WHERE id = $1 AND user_id = $2",
        [req.params.bottleId, userId]
      );
    }
    if (bottleResult.rows.length === 0 || !bottleResult.rows[0].image_url) {
      return res.status(404).send('No image');
    }
    const imageUrl = bottleResult.rows[0].image_url;
    if (imageUrl.startsWith('data:')) {
      // Parse base64 data URI: data:image/jpeg;base64,/9j/4AAQ...
      const match = imageUrl.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!match) return res.status(400).send('Invalid image');
      res.setHeader('Content-Type', match[1]);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(match[2], 'base64'));
    } else {
      // External URL — redirect to it
      res.redirect(imageUrl);
    }
  } catch (err) {
    console.error('Share image error:', err);
    res.status(500).send('Error');
  }
});

// Find Similar — server-side endpoint for share page visitors
const similarRateLimit = {}; // { token: { count, resetAt } }
app.post('/share/:token/similar', async (req, res) => {
  try {
    const token = req.params.token;
    // Rate limit: 10 calls per token per hour
    const now = Date.now();
    if (!similarRateLimit[token] || similarRateLimit[token].resetAt < now) {
      similarRateLimit[token] = { count: 0, resetAt: now + 3600000 };
    }
    if (similarRateLimit[token].count >= 10) {
      return res.status(429).json({ error: 'Rate limit exceeded. Try again later.' });
    }
    similarRateLimit[token].count++;

    const userResult = await pool.query(
      'SELECT id, openai_key FROM users WHERE share_token = $1', [token]
    );
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const user = userResult.rows[0];
    const apiKey = user.openai_key;
    if (!apiKey) return res.status(400).json({ error: 'AI suggestions not available for this collection.' });

    const { bottleIdx, type } = req.body; // type: 'bottle' | 'find'
    if (bottleIdx === undefined) return res.status(400).json({ error: 'Missing bottleIdx' });

    let items;
    if (type === 'find') {
      const result = await pool.query('SELECT data FROM finds WHERE user_id = $1', [user.id]);
      items = result.rows.map(r => r.data).sort((a,b) => (b.addedDate||'').localeCompare(a.addedDate||''));
    } else {
      const result = await pool.query('SELECT data FROM bottles WHERE user_id = $1', [user.id]);
      items = result.rows.map(r => r.data).filter(b => b.status !== 'consumed').sort((a,b) => (b.addedDate||'').localeCompare(a.addedDate||''));
    }

    const item = items[bottleIdx];
    if (!item) return res.status(404).json({ error: 'Item not found' });

    // Build category label
    const whiskyTypes = ['Scotch','Bourbon','Irish','Japanese','Rye','Single Malt','Blended','Tennessee'];
    const tequilaTypes = ['Tequila','Mezcal'];
    const sakeTypes = ['Junmai','Ginjo','Daiginjo','Nigori','Sparkling Sake','Sake'];
    const spiritTypes = ['Rum','Cognac','Brandy','Gin','Vodka','Other Spirit'];
    let catLabel = 'wines';
    if (whiskyTypes.includes(item.type)) catLabel = 'whiskeys';
    else if (tequilaTypes.includes(item.type)) catLabel = 'tequilas';
    else if (sakeTypes.includes(item.type)) catLabel = 'sake';
    else if (spiritTypes.includes(item.type)) catLabel = 'spirits';

    const details = [
      item.name,
      item.producer ? `by ${item.producer}` : '',
      item.region || '',
      item.grape ? `(${item.grape})` : '',
      item.vintage ? `${item.vintage}` : '',
      item.type || '',
      item.communityScore ? `score ${item.communityScore}/100` : '',
      item.price ? `~$${Math.round(item.price)}` : '',
      item.abv ? `${item.abv}% ABV` : '',
      item.age ? `${item.age} year` : '',
    ].filter(Boolean).join(', ');

    const prompt = `Given this ${item.type || 'bottle'}: ${details} — suggest 5 similar ${catLabel} that someone who enjoys this would also like. For each, give: name, producer, region, approximate price (USD), and a brief one-sentence reason why it's similar. Return ONLY a JSON array with objects having keys: name, producer, region, price, reason. No markdown, no explanation.`;

    const https = require('https');
    const openaiResp = await new Promise((resolve, reject) => {
      const postData = JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1000,
      });
      const req = https.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 30000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Invalid response')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(postData);
      req.end();
    });

    if (openaiResp.error) {
      return res.status(500).json({ error: openaiResp.error.message || 'AI error' });
    }

    const content = openaiResp.choices?.[0]?.message?.content || '';
    const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const suggestions = JSON.parse(jsonStr);

    res.json({ suggestions });
  } catch (err) {
    console.error('Find similar error:', err);
    res.status(500).json({ error: 'Failed to find suggestions' });
  }
});

// Share page — serve standalone HTML (NOT the SPA)
app.get('/share/:token', async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT id, name, share_show_values FROM users WHERE share_token = $1',
      [req.params.token]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link Not Found</title><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"><style>body{font-family:'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#F8F6F3;color:#1A1A1E;text-align:center}h2{margin-bottom:0.5rem}p{color:#6B6560}</style></head><body><div><h2>Link not found</h2><p>This share link may have been revoked or is invalid.</p></div></body></html>`);
    }
    const user = userResult.rows[0];
    const token = req.params.token;
    const bottlesResult = await pool.query(
      'SELECT id, data FROM bottles WHERE user_id = $1', [user.id]
    );
    const bottles = bottlesResult.rows.map(r => {
      const b = { id: r.id, ...r.data };
      if (!user.share_show_values) { delete b.marketValue; delete b.price; }
      if (b.imageUrl && b.imageUrl.startsWith('data:')) {
        b.imageUrl = `/share/${token}/image/${r.id}`;
      }
      delete b.consumptionHistory; delete b.editHistory;
      return b;
    });
    const findsResult = await pool.query(
      'SELECT id, data FROM finds WHERE user_id = $1', [user.id]
    );
    const finds = findsResult.rows.map(r => {
      const f = { id: r.id, ...r.data };
      if (f.imageUrl && f.imageUrl.startsWith('data:')) {
        f.imageUrl = `/share/${token}/image/${r.id}`;
      }
      return f;
    });
    const data = { bottles, finds, owner: { name: user.name || 'Collector' }, showValues: user.share_show_values };
    // Serve a fully standalone HTML page
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    res.send(buildSharePage(data));
  } catch (err) {
    console.error('Share page error:', err);
    res.status(500).send('Server error');
  }
});

function buildSharePage(data) {
  const { bottles, finds = [], owner, showValues } = data;
  const active = bottles.filter(b => b.status !== 'consumed');
  const total = active.reduce((s, b) => s + (b.quantity || 1), 0);
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const escJson = s => JSON.stringify(s).slice(1, -1); // for embedding in JS strings

  // Category classification (mirrors client-side logic)
  const whiskyTypes = ['Scotch','Bourbon','Irish','Japanese','Rye','Single Malt','Blended','Tennessee'];
  const tequilaTypes = ['Tequila','Mezcal'];
  const sakeTypes = ['Junmai','Ginjo','Daiginjo','Nigori','Sparkling Sake','Sake'];
  const spiritTypes = ['Rum','Cognac','Brandy','Gin','Vodka','Other Spirit'];
  function getCat(type) {
    if (!type) return 'wine';
    if (whiskyTypes.includes(type)) return 'whiskey';
    if (tequilaTypes.includes(type)) return 'tequila';
    if (sakeTypes.includes(type)) return 'sake';
    if (spiritTypes.includes(type)) return 'spirit';
    return 'wine';
  }

  // Category counts
  const catCounts = {};
  active.forEach(b => { const c = getCat(b.type); catCounts[c] = (catCounts[c] || 0) + (b.quantity || 1); });
  const catOrder = ['wine','whiskey','tequila','sake','spirit'];
  const catLabels = {wine:'Wine',whiskey:'Whiskey',tequila:'Tequila',sake:'Sake',spirit:'Spirit'};
  const catColors = {wine:'#8B1A1A',whiskey:'#CD853F',tequila:'#FFD700',sake:'#DC143C',spirit:'#4682B4'};
  const activeCats = catOrder.filter(c => catCounts[c]);

  const filterPills = activeCats.length > 1 ? `<div class="filters">
    <button class="pill active" onclick="filterCat('')">All (${total})</button>
    ${activeCats.map(c => `<button class="pill" onclick="filterCat('${c}')">${catLabels[c]} (${catCounts[c]})</button>`).join('')}
  </div>` : '';

  let valueHtml = '';
  if (showValues) {
    const tv = active.reduce((s,b) => s + (b.marketValue||0)*(b.quantity||1), 0);
    valueHtml = `<span style="color:#2D7A4F;font-weight:600;margin-left:0.75rem">Est. Value: $${Math.round(tv).toLocaleString()}</span>`;
  }

  const typeColors = {Red:'#8B1A1A',White:'#C9A96E','Rosé':'#D4A5A5',Sparkling:'#B8860B',Champagne:'#DAA520',Dessert:'#D2691E',Fortified:'#800020',Scotch:'#CD853F',Bourbon:'#D2691E',Irish:'#228B22',Japanese:'#4169E1',Rye:'#8B4513','Single Malt':'#A0522D',Blended:'#BC8F8F',Tennessee:'#A0522D',Tequila:'#FFD700',Mezcal:'#BDB76B',Junmai:'#CD5C5C',Ginjo:'#87CEEB',Daiginjo:'#4682B4',Nigori:'#F5F5DC','Sparkling Sake':'#FFB6C1',Sake:'#DC143C',Rum:'#8B4513',Cognac:'#B8860B',Brandy:'#CD853F',Gin:'#4682B4',Vodka:'#B0C4DE','Other Spirit':'#808080'};

  const cards = active.sort((a,b) => (b.addedDate||'').localeCompare(a.addedDate||'')).map((b, idx) => {
    const tc = typeColors[b.type] || '#999';
    const cat = getCat(b.type);
    const rating = b.rating ? '★'.repeat(b.rating)+'☆'.repeat(5-b.rating) : '';
    const score = b.communityScore ? `<span class="score">${Math.round(b.communityScore)}<small>/100</small></span>` : '';
    return `<div class="card" data-cat="${cat}" onclick="openCard(${idx})">
      ${score}
      <div class="card-top">
        <div class="color-bar" style="background:${tc}"></div>
        <div>
          <div class="card-title">${esc(b.name||'Unknown')}</div>
          <div class="card-sub">${esc(b.producer||'')} ${b.vintage?'· '+b.vintage:''}</div>
        </div>
      </div>
      <div class="card-chips">
        <span class="chip">${esc(b.type||'—')}</span>
        ${b.region?`<span class="chip">${esc(b.region)}</span>`:''}
        ${b.grape?`<span class="chip">${esc(b.grape)}</span>`:''}
      </div>
      <div class="card-foot">
        ${showValues&&b.marketValue?`<span class="price">$${Math.round(b.marketValue).toLocaleString()}</span>`:'<span></span>'}
        ${rating?`<span class="stars">${rating}</span>`:''}
      </div>
      ${(b.quantity||1)>1?`<span class="qty">×${b.quantity}</span>`:''}
    </div>`;
  }).join('');

  // Serialize bottle data for JS modal (strip large fields)
  const jsBottles = active.sort((a,b) => (b.addedDate||'').localeCompare(a.addedDate||'')).map(b => ({
    name: b.name || 'Unknown',
    producer: b.producer || '',
    type: b.type || '',
    vintage: b.vintage || null,
    region: b.region || '',
    grape: b.grape || '',
    rating: b.rating || 0,
    communityScore: b.communityScore || null,
    notes: b.notes || '',
    designation: b.designation || '',
    size: b.size || '',
    abv: b.abv || null,
    age: b.age || null,
    quantity: b.quantity || 1,
    marketValue: showValues ? (b.marketValue || null) : null,
    imageUrl: b.imageUrl || '',
  }));

  // Build finds cards
  const sortedFinds = finds.sort((a,b) => (b.addedDate||'').localeCompare(a.addedDate||''));
  const findCards = sortedFinds.map((f, idx) => {
    const tc = typeColors[f.type] || '#999';
    const score = f.communityScore ? `<span class="score">${Math.round(f.communityScore)}<small>/100</small></span>` : '';
    const loc = f.locationName || f.locationCity || '';
    return `<div class="card find-card-share" onclick="openFind(${idx})">
      ${score}
      <div class="card-top">
        <div class="color-bar" style="background:${tc}"></div>
        <div>
          <div class="card-title">${esc(f.name||'Unknown')}</div>
          <div class="card-sub">${esc(f.producer||'')} ${f.vintage?'· '+f.vintage:''}</div>
        </div>
      </div>
      <div class="card-chips">
        <span class="chip">${esc(f.type||'—')}</span>
        ${f.region?`<span class="chip">${esc(f.region)}</span>`:''}
      </div>
      ${loc ? `<div class="find-loc"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> ${esc(loc)}</div>` : ''}
    </div>`;
  }).join('');

  const jsFinds = sortedFinds.map(f => ({
    name: f.name || 'Unknown',
    producer: f.producer || '',
    type: f.type || '',
    vintage: f.vintage || null,
    region: f.region || '',
    grape: f.grape || '',
    communityScore: f.communityScore || null,
    notes: f.notes || '',
    locationName: f.locationName || '',
    locationCity: f.locationCity || '',
    locationCountry: f.locationCountry || '',
    imageUrl: f.imageUrl || '',
    abv: f.abv || null,
    price: f.price || null,
  }));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(owner.name)}'s Collection — Cellar</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@500;600&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'DM Sans',sans-serif;background:#F8F6F3;color:#1A1A1E;min-height:100vh;padding:1.5rem}
    @media(min-width:768px){body{padding:2rem 3rem}}
    h1{font-family:'Playfair Display',serif;font-size:1.75rem;font-weight:600;letter-spacing:-0.02em}
    .subtitle{color:#6B6560;margin-top:0.3rem;font-size:0.9rem}
    .filters{display:flex;flex-wrap:wrap;gap:0.4rem;margin:1.25rem 0}
    .pill{font-size:0.8rem;padding:0.35rem 0.85rem;border-radius:99px;background:#fff;color:#6B6560;border:1px solid #E8E4DE;cursor:pointer;font-family:inherit;font-weight:500;transition:all 0.15s}
    .pill:hover{border-color:#8B1A1A;color:#1A1A1E}
    .pill.active{background:#8B1A1A;color:#fff;border-color:#8B1A1A}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem}
    @media(max-width:480px){.grid{grid-template-columns:1fr;max-width:400px}}
    .card{background:#fff;border-radius:12px;padding:1.25rem;border:1px solid #E8E4DE;box-shadow:0 1px 3px rgba(0,0,0,0.04);position:relative;overflow:hidden;cursor:pointer;transition:all 0.15s}
    .card:hover{transform:translateY(-3px);box-shadow:0 4px 12px rgba(0,0,0,0.1);border-color:#C9A96E}
    .card.hidden{display:none}
    .card-top{display:flex;align-items:flex-start;gap:0.75rem;margin-bottom:0.75rem}
    .color-bar{width:4px;height:48px;border-radius:4px;flex-shrink:0}
    .card-title{font-weight:600;font-size:0.95rem;line-height:1.3}
    .card-sub{font-size:0.82rem;color:#6B6560;margin-top:0.15rem}
    .card-chips{display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.75rem}
    .chip{font-size:0.75rem;padding:0.2rem 0.5rem;border-radius:6px;background:#F0EDE8;color:#6B6560}
    .card-foot{display:flex;justify-content:space-between;align-items:center;margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid #E8E4DE}
    .price{font-weight:600;font-size:0.9rem}
    .stars{font-size:0.85rem;color:#C9A96E}
    .qty{position:absolute;top:3.4rem;right:0.5rem;background:#F0EDE8;border-radius:99px;padding:0.15rem 0.55rem;font-size:0.72rem;font-weight:600;color:#6B6560}
    .score{position:absolute;top:0.25rem;right:0.5rem;background:#C9A96E;color:#fff;font-size:0.68rem;font-weight:700;padding:0.15rem 0.45rem;border-radius:4px;z-index:3;line-height:1.2}
    .score small{font-weight:400;opacity:0.7;font-size:0.58rem}
    .find-loc{font-size:0.78rem;color:#6B6560;margin-top:0.5rem;display:flex;align-items:center;gap:0.25rem}
    .tabs{display:flex;gap:0;margin-bottom:1.25rem;border-bottom:2px solid #E8E4DE}
    .tab{padding:0.6rem 1.25rem;font-size:0.9rem;font-weight:600;color:#9B9590;cursor:pointer;border:none;background:none;font-family:inherit;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all 0.15s}
    .tab:hover{color:#1A1A1E}
    .tab.active{color:#8B1A1A;border-bottom-color:#8B1A1A}
    .tab-panel{display:none}
    .tab-panel.active{display:block}
    .empty{text-align:center;padding:3rem 1rem;color:#9B9590}
    .footer{text-align:center;margin-top:2rem;padding-top:1rem;border-top:1px solid #E8E4DE;font-size:0.78rem;color:#9B9590}
    .footer a{color:#8B1A1A;text-decoration:none;font-weight:500}
    /* Modal */
    .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100;align-items:center;justify-content:center;padding:1rem}
    .modal-overlay.open{display:flex}
    .modal-box{background:#fff;border-radius:16px;max-width:500px;width:100%;max-height:90vh;overflow-y:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.3)}
    .modal-close{position:absolute;top:0.75rem;right:0.75rem;background:rgba(0,0,0,0.05);border:none;font-size:1.5rem;cursor:pointer;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#6B6560;z-index:5}
    .modal-close:hover{background:rgba(0,0,0,0.1)}
    .modal-img{width:100%;max-height:300px;object-fit:contain;border-radius:16px 16px 0 0;background:#F8F6F3}
    .modal-body{padding:1.5rem}
    .modal-title{font-family:'Playfair Display',serif;font-size:1.35rem;font-weight:600;margin-bottom:0.25rem}
    .modal-subtitle{font-size:0.88rem;color:#6B6560;margin-bottom:1rem}
    .modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem}
    .modal-field label{font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#9B9590;display:block;margin-bottom:0.15rem}
    .modal-field .val{font-size:0.9rem;font-weight:500}
    .modal-stars{color:#C9A96E;font-size:1rem}
    .modal-notes{background:#F8F6F3;border-radius:8px;padding:0.75rem;font-size:0.85rem;line-height:1.5;color:#6B6560;margin-top:0.75rem}
    .btn-similar-share{font-family:inherit;font-size:0.82rem;font-weight:500;padding:0.4rem 1rem;border-radius:8px;border:1px solid rgba(201,169,110,0.3);background:rgba(201,169,110,0.12);color:#A07D3A;cursor:pointer;transition:all 0.15s}
    .btn-similar-share:hover{background:rgba(201,169,110,0.22)}
    .sim-spin{width:28px;height:28px;border:3px solid #E8E4DE;border-top:3px solid #C9A96E;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto}
    @keyframes spin{to{transform:rotate(360deg)}}
    @media(max-width:480px){.modal-grid{grid-template-columns:1fr}.modal-box{margin:0.5rem}}
  </style>
</head>
<body>
  <header style="margin-bottom:1rem">
    <h1>${esc(owner.name)}'s Collection</h1>
    <p class="subtitle">${total} bottle${total!==1?'s':''}${finds.length ? ' · ' + finds.length + ' find' + (finds.length!==1?'s':'') : ''} ${valueHtml}</p>
  </header>
  ${finds.length > 0 ? `<div class="tabs">
    <button class="tab active" onclick="switchTab('collection')">Collection (${total})</button>
    <button class="tab" onclick="switchTab('finds')">Restaurant Finds (${finds.length})</button>
  </div>` : ''}
  <div class="tab-panel active" id="panel-collection">
    ${filterPills}
    <div class="grid" id="grid">${cards}</div>
    ${active.length===0?'<div class="empty"><h3>Empty collection</h3><p>No bottles in this collection yet.</p></div>':''}
  </div>
  <div class="tab-panel" id="panel-finds">
    <div class="grid">${findCards}</div>
    ${finds.length===0?'<div class="empty"><h3>No finds yet</h3><p>No restaurant finds to show.</p></div>':''}
  </div>
  <div class="footer">Shared via <a href="/">Cellar</a></div>

  <div class="modal-overlay" id="modal" onclick="closeModal(event)">
    <div class="modal-box" onclick="event.stopPropagation()">
      <button class="modal-close" onclick="document.getElementById('modal').classList.remove('open')">&times;</button>
      <div id="modalContent"></div>
    </div>
  </div>

  <script>
    var bottles = ${JSON.stringify(jsBottles)};
    var finds = ${JSON.stringify(jsFinds)};
    function switchTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('panel-' + tab).classList.add('active');
    }
    function filterCat(cat) {
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      event.target.classList.add('active');
      document.querySelectorAll('#grid .card').forEach(c => {
        c.classList.toggle('hidden', cat && c.dataset.cat !== cat);
      });
    }
    function openFind(idx) {
      var f = finds[idx];
      if (!f) return;
      var img = f.imageUrl ? '<img class="modal-img" src="' + f.imageUrl + '" onerror="this.style.display=\\'none\\'">' : '';
      var scoreHtml = f.communityScore ? '<div class="modal-field"><label>Score</label><div class="val" style="color:#C9A96E;font-weight:700">' + Math.round(f.communityScore) + '/100</div></div>' : '';
      var loc = f.locationName || '';
      var city = [f.locationCity, f.locationCountry].filter(Boolean).join(', ');
      var html = img +
        '<div class="modal-body">' +
        '<div class="modal-title">' + esc(f.name) + '</div>' +
        '<div class="modal-subtitle">' + esc(f.producer) + (f.vintage ? ' \\u00b7 ' + f.vintage : '') + (f.region ? ' \\u00b7 ' + esc(f.region) : '') + '</div>' +
        '<div class="modal-grid">' +
        '<div class="modal-field"><label>Type</label><div class="val">' + esc(f.type || '\\u2014') + '</div></div>' +
        (f.grape ? '<div class="modal-field"><label>Grape</label><div class="val">' + esc(f.grape) + '</div></div>' : '') +
        (f.region ? '<div class="modal-field"><label>Region</label><div class="val">' + esc(f.region) + '</div></div>' : '') +
        (f.abv ? '<div class="modal-field"><label>ABV</label><div class="val">' + f.abv + '%</div></div>' : '') +
        (f.price ? '<div class="modal-field"><label>Price</label><div class="val">$' + Math.round(f.price) + '</div></div>' : '') +
        scoreHtml +
        (loc ? '<div class="modal-field"><label>Restaurant</label><div class="val">' + esc(loc) + '</div></div>' : '') +
        (city ? '<div class="modal-field"><label>Location</label><div class="val">' + esc(city) + '</div></div>' : '') +
        '</div>' +
        (f.notes ? '<div class="modal-notes">' + esc(f.notes) + '</div>' : '') +
        '<div style="margin-top:1rem;text-align:center"><button class="btn-similar-share" onclick="findSimilarShare(' + idx + ',\\'find\\')">' + getSimilarLbl(f.type) + '</button></div>' +
        '<div id="shareSimilar"></div>' +
        '</div>';
      document.getElementById('modalContent').innerHTML = html;
      document.getElementById('modal').classList.add('open');
    }
    function openCard(idx) {
      var b = bottles[idx];
      if (!b) return;
      var img = b.imageUrl ? '<img class="modal-img" src="' + b.imageUrl + '" onerror="this.style.display=\\'none\\'">' : '';
      var stars = b.rating ? '<div class="modal-stars">' + '★'.repeat(b.rating) + '☆'.repeat(5-b.rating) + '</div>' : '';
      var scoreHtml = b.communityScore ? '<div class="modal-field"><label>Score</label><div class="val" style="color:#C9A96E;font-weight:700">' + Math.round(b.communityScore) + '/100</div></div>' : '';
      var priceHtml = b.marketValue ? '<div class="modal-field"><label>Est. Value</label><div class="val" style="color:#2D7A4F">$' + Math.round(b.marketValue).toLocaleString() + '</div></div>' : '';
      var html = img +
        '<div class="modal-body">' +
        '<div class="modal-title">' + esc(b.name) + '</div>' +
        '<div class="modal-subtitle">' + esc(b.producer) + (b.vintage ? ' · ' + b.vintage : '') + (b.region ? ' · ' + esc(b.region) : '') + '</div>' +
        stars +
        '<div class="modal-grid">' +
        '<div class="modal-field"><label>Type</label><div class="val">' + esc(b.type || '—') + '</div></div>' +
        (b.grape ? '<div class="modal-field"><label>Grape</label><div class="val">' + esc(b.grape) + '</div></div>' : '') +
        (b.region ? '<div class="modal-field"><label>Region</label><div class="val">' + esc(b.region) + '</div></div>' : '') +
        (b.designation ? '<div class="modal-field"><label>Designation</label><div class="val">' + esc(b.designation) + '</div></div>' : '') +
        (b.size ? '<div class="modal-field"><label>Size</label><div class="val">' + esc(b.size) + '</div></div>' : '') +
        (b.abv ? '<div class="modal-field"><label>ABV</label><div class="val">' + b.abv + '%</div></div>' : '') +
        (b.age ? '<div class="modal-field"><label>Age</label><div class="val">' + b.age + ' years</div></div>' : '') +
        (b.quantity > 1 ? '<div class="modal-field"><label>Quantity</label><div class="val">' + b.quantity + '</div></div>' : '') +
        scoreHtml + priceHtml +
        '</div>' +
        (b.notes ? '<div class="modal-notes">' + esc(b.notes) + '</div>' : '') +
        '<div style="margin-top:1rem;text-align:center"><button class="btn-similar-share" onclick="findSimilarShare(' + idx + ',\\'bottle\\')">' + getSimilarLbl(b.type) + '</button></div>' +
        '<div id="shareSimilar"></div>' +
        '</div>';
      document.getElementById('modalContent').innerHTML = html;
      document.getElementById('modal').classList.add('open');
    }
    function getSimilarLbl(type) {
      var w = ['Scotch','Bourbon','Irish','Japanese','Rye','Single Malt','Blended','Tennessee'];
      var t = ['Tequila','Mezcal'];
      var sk = ['Junmai','Ginjo','Daiginjo','Nigori','Sparkling Sake','Sake'];
      var sp = ['Rum','Cognac','Brandy','Gin','Vodka','Other Spirit'];
      if (w.indexOf(type) >= 0) return 'Similar Whiskeys';
      if (t.indexOf(type) >= 0) return 'Similar Tequilas';
      if (sk.indexOf(type) >= 0) return 'Similar Sake';
      if (sp.indexOf(type) >= 0) return 'Similar Spirits';
      return 'Similar Wines';
    }
    function findSimilarShare(idx, type) {
      var el = document.getElementById('shareSimilar');
      if (!el) return;
      if (el.innerHTML && !el.querySelector('.sim-spin')) { el.innerHTML = ''; return; }
      el.innerHTML = '<div style="text-align:center;padding:1.5rem"><div class="sim-spin"></div><p style="color:#9B9590;font-size:0.85rem;margin-top:0.75rem">Finding suggestions…</p></div>';
      fetch(window.location.pathname + '/similar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bottleIdx: idx, type: type })
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.error) { el.innerHTML = '<p style="color:#9B9590;text-align:center;padding:0.75rem;font-size:0.85rem">' + esc(data.error) + '</p>'; return; }
        var s = data.suggestions || [];
        if (!s.length) { el.innerHTML = '<p style="color:#9B9590;text-align:center;padding:0.75rem;font-size:0.85rem">No suggestions found.</p>'; return; }
        var html = '<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid #E8E4DE"><h4 style="font-family:\\'DM Sans\\',sans-serif;font-weight:600;font-size:0.95rem;margin-bottom:0.75rem">Suggestions</h4>';
        s.forEach(function(item) {
          html += '<div style="padding:0.75rem;margin-bottom:0.5rem;background:#F8F6F3;border-radius:8px;border:1px solid #E8E4DE">' +
            '<div style="display:flex;justify-content:space-between;gap:0.5rem"><span style="font-weight:600;font-size:0.9rem">' + esc(item.name) + '</span>' +
            (item.price ? '<span style="font-weight:600;font-size:0.82rem;color:#2D7A4F;white-space:nowrap">~$' + (typeof item.price === 'number' ? Math.round(item.price) : item.price) + '</span>' : '') +
            '</div>' +
            '<div style="font-size:0.8rem;color:#6B6560;margin-top:0.15rem">' + esc(item.producer || '') + (item.region ? ' \\u00b7 ' + esc(item.region) : '') + '</div>' +
            '<div style="font-size:0.8rem;color:#9B9590;margin-top:0.35rem;font-style:italic;line-height:1.4">' + esc(item.reason || '') + '</div></div>';
        });
        html += '</div>';
        el.innerHTML = html;
      }).catch(function(err) {
        el.innerHTML = '<p style="color:#C0392B;text-align:center;padding:0.75rem;font-size:0.85rem">Could not load suggestions.</p>';
      });
    }
    function closeModal(e) { if (e.target === document.getElementById('modal')) document.getElementById('modal').classList.remove('open'); }
    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') document.getElementById('modal').classList.remove('open'); });
  </script>
</body>
</html>`;
}

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`Cellar running on port ${PORT}`));
