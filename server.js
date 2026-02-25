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

// Serve bottle image for share page (public, validated by share token)
app.get('/share/:token/image/:bottleId', async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT id FROM users WHERE share_token = $1', [req.params.token]
    );
    if (userResult.rows.length === 0) return res.status(404).send('Not found');
    const userId = userResult.rows[0].id;
    const bottleResult = await pool.query(
      "SELECT data->>'imageUrl' AS image_url FROM bottles WHERE id = $1 AND user_id = $2",
      [req.params.bottleId, userId]
    );
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
    const token = req.params.token;
    const bottles = bottlesResult.rows.map(r => {
      const b = { id: r.id, ...r.data };
      if (!user.share_show_values) { delete b.marketValue; delete b.price; }
      // Replace base64 images with a URL to the image endpoint
      if (b.imageUrl && b.imageUrl.startsWith('data:')) {
        b.imageUrl = `/share/${token}/image/${r.id}`;
      }
      delete b.consumptionHistory; delete b.editHistory;
      return b;
    });
    const data = { bottles, owner: { name: user.name || 'Collector' }, showValues: user.share_show_values };
    // Serve a fully standalone HTML page
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');
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
    .score{position:absolute;top:0.5rem;right:0.5rem;background:#C9A96E;color:#fff;font-size:0.68rem;font-weight:700;padding:0.15rem 0.45rem;border-radius:4px;z-index:3;line-height:1.2}
    .score small{font-weight:400;opacity:0.7;font-size:0.58rem}
    .empty{text-align:center;padding:3rem 1rem;color:#9B9590}
    .footer{text-align:center;margin-top:2rem;padding-top:1rem;border-top:1px solid #E8E4DE;font-size:0.78rem;color:#9B9590}
    .footer a{color:#8B1A1A;text-decoration:none;font-weight:500}
    /* Modal */
    .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100;align-items:center;justify-content:center;padding:1rem}
    .modal-overlay.open{display:flex}
    .modal-box{background:#fff;border-radius:16px;max-width:500px;width:100%;max-height:90vh;overflow-y:auto;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.3)}
    .modal-close{position:absolute;top:0.75rem;right:0.75rem;background:rgba(0,0,0,0.05);border:none;font-size:1.5rem;cursor:pointer;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#6B6560;z-index:5}
    .modal-close:hover{background:rgba(0,0,0,0.1)}
    .modal-img{width:100%;height:240px;object-fit:cover;border-radius:16px 16px 0 0}
    .modal-body{padding:1.5rem}
    .modal-title{font-family:'Playfair Display',serif;font-size:1.35rem;font-weight:600;margin-bottom:0.25rem}
    .modal-subtitle{font-size:0.88rem;color:#6B6560;margin-bottom:1rem}
    .modal-grid{display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-bottom:1rem}
    .modal-field label{font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:#9B9590;display:block;margin-bottom:0.15rem}
    .modal-field .val{font-size:0.9rem;font-weight:500}
    .modal-stars{color:#C9A96E;font-size:1rem}
    .modal-notes{background:#F8F6F3;border-radius:8px;padding:0.75rem;font-size:0.85rem;line-height:1.5;color:#6B6560;margin-top:0.75rem}
    @media(max-width:480px){.modal-grid{grid-template-columns:1fr}.modal-box{margin:0.5rem}}
  </style>
</head>
<body>
  <header style="margin-bottom:1.5rem">
    <h1>${esc(owner.name)}'s Collection</h1>
    <p class="subtitle">${total} bottle${total!==1?'s':''} ${valueHtml}</p>
  </header>
  ${filterPills}
  <div class="grid" id="grid">${cards}</div>
  ${active.length===0?'<div class="empty"><h3>Empty collection</h3><p>No bottles in this collection yet.</p></div>':''}
  <div class="footer">Shared via <a href="/">Cellar</a></div>

  <div class="modal-overlay" id="modal" onclick="closeModal(event)">
    <div class="modal-box" onclick="event.stopPropagation()">
      <button class="modal-close" onclick="document.getElementById('modal').classList.remove('open')">&times;</button>
      <div id="modalContent"></div>
    </div>
  </div>

  <script>
    var bottles = ${JSON.stringify(jsBottles)};
    function filterCat(cat) {
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      event.target.classList.add('active');
      document.querySelectorAll('.card').forEach(c => {
        c.classList.toggle('hidden', cat && c.dataset.cat !== cat);
      });
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
        '</div>';
      document.getElementById('modalContent').innerHTML = html;
      document.getElementById('modal').classList.add('open');
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
