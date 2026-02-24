const router = require('express').Router();
const { authRequired } = require('../middleware/auth');

router.use(authRequired);

// Get all tastings
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query('SELECT id, data FROM tastings WHERE user_id = $1', [req.userId]);
    res.json(result.rows.map(r => ({ id: r.id, ...r.data })));
  } catch (err) {
    console.error('Get tastings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create tasting
router.post('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const tasting = req.body;
    const id = tasting.id || Date.now().toString();
    await pool.query(
      `INSERT INTO tastings (id, user_id, data) VALUES ($1, $2, $3)
       ON CONFLICT (id, user_id) DO UPDATE SET data = $3, updated_at = NOW()`,
      [id, req.userId, JSON.stringify(tasting)]
    );
    res.json({ ok: true, id });
  } catch (err) {
    console.error('Create tasting error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete tasting
router.delete('/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query('DELETE FROM tastings WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete tasting error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
