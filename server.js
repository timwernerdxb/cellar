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

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bottles', require('./routes/bottles'));
app.use('/api/tastings', require('./routes/tastings'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/images', require('./routes/images'));
app.use('/api/share', require('./routes/share'));

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
    const bottlesResult = await pool.query(
      'SELECT id, data FROM bottles WHERE user_id = $1', [user.id]
    );
    const bottles = bottlesResult.rows.map(r => {
      const b = { id: r.id, ...r.data };
      if (!user.share_show_values) { delete b.marketValue; delete b.price; }
      if (b.imageUrl && b.imageUrl.startsWith('data:')) delete b.imageUrl;
      delete b.consumptionHistory; delete b.editHistory;
      return b;
    });
    const data = { bottles, owner: { name: user.name || 'Collector' }, showValues: user.share_show_values };
    // Serve a fully standalone HTML page
    res.send(buildSharePage(data));
  } catch (err) {
    console.error('Share page error:', err);
    res.status(500).send('Server error');
  }
});

function buildSharePage(data) {
  const { bottles, owner, showValues } = data;
  const active = bottles.filter(b => b.status !== 'consumed');
  const total = active.reduce((s, b) => s + (b.quantity || 1), 0);
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const typeCounts = {};
  active.forEach(b => { typeCounts[b.type] = (typeCounts[b.type] || 0) + (b.quantity || 1); });
  const typeChips = Object.entries(typeCounts).sort((a,b) => b[1]-a[1])
    .map(([t,c]) => `<span class="chip">${esc(t)} (${c})</span>`).join('');

  let valueHtml = '';
  if (showValues) {
    const tv = active.reduce((s,b) => s + (b.marketValue||0)*(b.quantity||1), 0);
    valueHtml = `<span style="color:#2D7A4F;font-weight:600;margin-left:0.75rem">Est. Value: $${Math.round(tv).toLocaleString()}</span>`;
  }

  const typeColors = {Red:'#8B1A1A',White:'#C9A96E',Rosé:'#D4A5A5',Sparkling:'#B8860B',Champagne:'#DAA520',Dessert:'#D2691E',Fortified:'#800020',Scotch:'#CD853F',Bourbon:'#D2691E',Irish:'#228B22',Japanese:'#4169E1',Rye:'#8B4513',SingleMalt:'#A0522D',Blended:'#BC8F8F',Tennessee:'#A0522D',Tequila:'#FFD700',Mezcal:'#BDB76B',Junmai:'#CD5C5C',Ginjo:'#87CEEB',Daiginjo:'#4682B4',Nigori:'#F5F5DC',SparklingSake:'#FFB6C1',Sake:'#DC143C',Rum:'#8B4513',Cognac:'#B8860B',Brandy:'#CD853F',Gin:'#4682B4',Vodka:'#B0C4DE',OtherSpirit:'#808080'};

  const cards = active.sort((a,b) => (b.addedDate||'').localeCompare(a.addedDate||'')).map(b => {
    const tc = typeColors[(b.type||'').replace(/\s/g,'')] || '#999';
    const rating = b.rating ? '★'.repeat(b.rating)+'☆'.repeat(5-b.rating) : '';
    const score = b.communityScore ? `<span class="score">${Math.round(b.communityScore)}<small>/100</small></span>` : '';
    return `<div class="card">
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
    .chips{display:flex;flex-wrap:wrap;gap:0.4rem;margin:1.25rem 0}
    .chip{font-size:0.75rem;padding:0.2rem 0.5rem;border-radius:6px;background:#F0EDE8;color:#6B6560}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem}
    @media(max-width:480px){.grid{grid-template-columns:1fr;max-width:400px}}
    .card{background:#fff;border-radius:12px;padding:1.25rem;border:1px solid #E8E4DE;box-shadow:0 1px 3px rgba(0,0,0,0.04);position:relative;overflow:hidden}
    .card-top{display:flex;align-items:flex-start;gap:0.75rem;margin-bottom:0.75rem}
    .color-bar{width:4px;height:48px;border-radius:4px;flex-shrink:0}
    .card-title{font-weight:600;font-size:0.95rem;line-height:1.3}
    .card-sub{font-size:0.82rem;color:#6B6560;margin-top:0.15rem}
    .card-chips{display:flex;flex-wrap:wrap;gap:0.5rem;margin-top:0.75rem}
    .card-foot{display:flex;justify-content:space-between;align-items:center;margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid #E8E4DE}
    .price{font-weight:600;font-size:0.9rem}
    .stars{font-size:0.85rem;color:#C9A96E}
    .qty{position:absolute;top:3.4rem;right:0.5rem;background:#F0EDE8;border-radius:99px;padding:0.15rem 0.55rem;font-size:0.72rem;font-weight:600;color:#6B6560}
    .score{position:absolute;top:0.2rem;left:0.25rem;background:#C9A96E;color:#fff;font-size:0.68rem;font-weight:700;padding:0.12rem 0.4rem;border-radius:4px;z-index:3;line-height:1.2}
    .score small{font-weight:400;opacity:0.7;font-size:0.58rem}
    .empty{text-align:center;padding:3rem 1rem;color:#9B9590}
    .footer{text-align:center;margin-top:2rem;padding-top:1rem;border-top:1px solid #E8E4DE;font-size:0.78rem;color:#9B9590}
    .footer a{color:#8B1A1A;text-decoration:none;font-weight:500}
  </style>
</head>
<body>
  <header style="margin-bottom:1.5rem">
    <h1>${esc(owner.name)}'s Collection</h1>
    <p class="subtitle">${total} bottle${total!==1?'s':''} ${valueHtml}</p>
  </header>
  <div class="chips">${typeChips}</div>
  <div class="grid">${cards}</div>
  ${active.length===0?'<div class="empty"><h3>Empty collection</h3><p>No bottles in this collection yet.</p></div>':''}
  <div class="footer">Shared via <a href="/">Cellar</a></div>
</body>
</html>`;
}

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`Cellar running on port ${PORT}`));
