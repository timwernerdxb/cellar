const router = require('express').Router();
const crypto = require('crypto');
const { authRequired } = require('../middleware/auth');

// Generate share link (authenticated)
router.post('/generate', authRequired, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const token = crypto.randomUUID();
    await pool.query(
      'UPDATE users SET share_token = $1 WHERE id = $2',
      [token, req.userId]
    );
    res.json({ ok: true, token, url: `/share/${token}` });
  } catch (err) {
    console.error('Share generate error:', err);
    res.status(500).json({ error: 'Failed to generate share link' });
  }
});

// Update share settings (authenticated)
router.put('/settings', authRequired, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { showValues } = req.body;
    await pool.query(
      'UPDATE users SET share_show_values = $1 WHERE id = $2',
      [!!showValues, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Share settings error:', err);
    res.status(500).json({ error: 'Failed to update share settings' });
  }
});

// Get current share status (authenticated)
router.get('/status', authRequired, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'SELECT share_token, share_show_values FROM users WHERE id = $1',
      [req.userId]
    );
    const user = result.rows[0];
    res.json({
      token: user?.share_token || null,
      showValues: user?.share_show_values || false,
      url: user?.share_token ? `/share/${user.share_token}` : null,
    });
  } catch (err) {
    console.error('Share status error:', err);
    res.status(500).json({ error: 'Failed to get share status' });
  }
});

// Revoke share link (authenticated)
router.delete('/revoke', authRequired, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query(
      'UPDATE users SET share_token = NULL WHERE id = $1',
      [req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Share revoke error:', err);
    res.status(500).json({ error: 'Failed to revoke share link' });
  }
});

// Public view — no auth required
router.get('/:token', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const userResult = await pool.query(
      'SELECT id, name, share_show_values FROM users WHERE share_token = $1',
      [req.params.token]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Share link not found or has been revoked' });
    }
    const user = userResult.rows[0];
    const bottlesResult = await pool.query(
      'SELECT id, data FROM bottles WHERE user_id = $1',
      [user.id]
    );
    const bottles = bottlesResult.rows.map(r => {
      const bottle = { id: r.id, ...r.data };
      // Strip market value if not showing values
      if (!user.share_show_values) {
        delete bottle.marketValue;
        delete bottle.price;
      }
      // Strip base64 image data to reduce payload (keep URL images)
      if (bottle.imageUrl && bottle.imageUrl.startsWith('data:')) {
        delete bottle.imageUrl;
      }
      // Strip other heavy fields not needed for shared view
      delete bottle.consumptionHistory;
      delete bottle.editHistory;
      return bottle;
    });
    res.json({
      bottles,
      owner: { name: user.name || 'Collector' },
      showValues: user.share_show_values,
    });
  } catch (err) {
    console.error('Share view error:', err);
    res.status(500).json({ error: 'Failed to load shared collection' });
  }
});

module.exports = router;
