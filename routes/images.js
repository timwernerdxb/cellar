const router = require('express').Router();
const { authRequired } = require('../middleware/auth');
const https = require('https');
const http = require('http');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Serve a stored bottle photo. Public (no auth) so shared cellar pages can
// display images; ids are unguessable UUIDs, same model as share tokens.
router.get('/i/:id', async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid image id' });
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query('SELECT mime, data FROM user_images WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', result.rows[0].mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(result.rows[0].data);
  } catch (err) {
    console.error('Image fetch error:', err.message);
    res.status(500).json({ error: 'Image fetch failed' });
  }
});

router.use(authRequired);

// Store a bottle photo server-side; returns a stable URL to reference it by.
// Keeps base64 photos out of the client's localStorage (~5MB quota).
router.post('/upload', async (req, res) => {
  const { dataUrl } = req.body || {};
  const match = typeof dataUrl === 'string'
    ? dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp|gif|avif));base64,([A-Za-z0-9+/=]+)$/i)
    : null;
  if (!match) return res.status(400).json({ error: 'Expected a base64 image data URL' });

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) return res.status(400).json({ error: 'Empty image' });
  if (buffer.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 5MB)' });

  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'INSERT INTO user_images (user_id, mime, data) VALUES ($1, $2, $3) RETURNING id',
      [req.userId, match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase(), buffer]
    );
    res.json({ ok: true, url: `/api/images/i/${result.rows[0].id}` });
  } catch (err) {
    console.error('Image upload error:', err.message);
    res.status(500).json({ error: 'Image upload failed' });
  }
});

// Search for bottle images by query
router.get('/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  try {
    const query = encodeURIComponent(q + ' bottle product photo');
    // Use DuckDuckGo instant answer API for image search (no API key needed)
    // Fallback: use a simple Google image scrape via the JSON endpoint
    const images = await searchImages(q);
    res.json({ images });
  } catch (err) {
    console.error('Image search error:', err.message);
    res.status(500).json({ error: 'Image search failed' });
  }
});

// Proxy an external image to avoid CORS issues
router.get('/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  try {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const proxyReq = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CellarBot/1.0)',
        'Accept': 'image/*',
      },
      timeout: 8000,
    }, (proxyRes) => {
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        // Follow redirect once
        const redirectClient = proxyRes.headers.location.startsWith('https') ? https : http;
        redirectClient.get(proxyRes.headers.location, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CellarBot/1.0)', 'Accept': 'image/*' },
          timeout: 8000,
        }, (redirectRes) => {
          const contentType = redirectRes.headers['content-type'] || 'image/jpeg';
          if (!contentType.startsWith('image/')) {
            return res.status(400).json({ error: 'Not an image' });
          }
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          redirectRes.pipe(res);
        }).on('error', () => res.status(502).json({ error: 'Redirect failed' }));
        return;
      }

      const contentType = proxyRes.headers['content-type'] || 'image/jpeg';
      if (!contentType.startsWith('image/')) {
        return res.status(400).json({ error: 'Not an image' });
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      proxyRes.pipe(res);
    });

    proxyReq.on('error', () => res.status(502).json({ error: 'Proxy fetch failed' }));
    proxyReq.on('timeout', () => { proxyReq.destroy(); res.status(504).json({ error: 'Timeout' }); });
  } catch (err) {
    res.status(400).json({ error: 'Invalid URL' });
  }
});

// Search images using multiple free sources
async function searchImages(query) {
  const results = [];

  // Try Bing Image Search via scraping the mobile page
  try {
    const bingResults = await searchBingImages(query);
    results.push(...bingResults);
  } catch (e) {
    console.warn('Bing image search failed:', e.message);
  }

  // If we got no results, try DuckDuckGo
  if (results.length === 0) {
    try {
      const ddgResults = await searchDDGImages(query);
      results.push(...ddgResults);
    } catch (e) {
      console.warn('DDG image search failed:', e.message);
    }
  }

  return results.slice(0, 8);
}

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/json,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...options.headers,
      },
      timeout: 8000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location, options).then(resolve).catch(reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function searchBingImages(query) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query + ' bottle')}&form=HDRSC2&first=1`;
  const html = await fetchUrl(url);

  const images = [];
  // Extract image URLs from Bing's murl parameter in the markup
  const murlRegex = /murl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/g;
  let match;
  while ((match = murlRegex.exec(html)) !== null && images.length < 8) {
    const imgUrl = match[1].replace(/&amp;/g, '&');
    if (imgUrl.match(/\.(jpg|jpeg|png|webp)/i)) {
      images.push({ url: imgUrl, source: 'bing' });
    }
  }
  return images;
}

async function searchDDGImages(query) {
  // DuckDuckGo requires a token first
  const tokenUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query + ' bottle')}&iax=images&ia=images`;
  const html = await fetchUrl(tokenUrl);

  const vqd = html.match(/vqd=['"]([^'"]+)['"]/)?.[1];
  if (!vqd) return [];

  const apiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query + ' bottle')}&vqd=${vqd}&f=,,,,,&p=1`;
  const json = await fetchUrl(apiUrl);

  try {
    const data = JSON.parse(json);
    return (data.results || []).slice(0, 8).map(r => ({
      url: r.image,
      thumbnail: r.thumbnail,
      source: 'ddg',
    }));
  } catch {
    return [];
  }
}

module.exports = router;
