const router = require('express').Router();
const { authRequired } = require('../middleware/auth');

router.use(authRequired);

// Upload: bulk push localStorage data to server
router.post('/upload', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { bottles = [], tastings = [] } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Upsert all bottles
      for (const bottle of bottles) {
        const id = bottle.id || Date.now().toString();
        await client.query(
          `INSERT INTO bottles (id, user_id, data) VALUES ($1, $2, $3)
           ON CONFLICT (id, user_id) DO UPDATE SET data = $3, updated_at = NOW()`,
          [id, req.userId, JSON.stringify(bottle)]
        );
      }

      // Upsert all tastings
      for (const tasting of tastings) {
        const id = tasting.id || Date.now().toString();
        await client.query(
          `INSERT INTO tastings (id, user_id, data) VALUES ($1, $2, $3)
           ON CONFLICT (id, user_id) DO UPDATE SET data = $3, updated_at = NOW()`,
          [id, req.userId, JSON.stringify(tasting)]
        );
      }

      await client.query('COMMIT');
      res.json({ ok: true, bottles: bottles.length, tastings: tastings.length });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Sync upload error:', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Download: pull all server data to client
router.get('/download', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const bottlesResult = await pool.query('SELECT id, data FROM bottles WHERE user_id = $1', [req.userId]);
    const tastingsResult = await pool.query('SELECT id, data FROM tastings WHERE user_id = $1', [req.userId]);
    res.json({
      bottles: bottlesResult.rows.map(r => ({ id: r.id, ...r.data })),
      tastings: tastingsResult.rows.map(r => ({ id: r.id, ...r.data })),
    });
  } catch (err) {
    console.error('Sync download error:', err);
    res.status(500).json({ error: 'Download failed' });
  }
});

module.exports = router;
