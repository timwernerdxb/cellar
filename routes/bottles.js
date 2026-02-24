const router = require('express').Router();
const { authRequired } = require('../middleware/auth');

router.use(authRequired);

// Get all bottles
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query('SELECT id, data FROM bottles WHERE user_id = $1', [req.userId]);
    res.json(result.rows.map(r => ({ id: r.id, ...r.data })));
  } catch (err) {
    console.error('Get bottles error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create bottle
router.post('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const bottle = req.body;
    const id = bottle.id || Date.now().toString();
    await pool.query(
      `INSERT INTO bottles (id, user_id, data) VALUES ($1, $2, $3)
       ON CONFLICT (id, user_id) DO UPDATE SET data = $3, updated_at = NOW()`,
      [id, req.userId, JSON.stringify(bottle)]
    );
    res.json({ ok: true, id });
  } catch (err) {
    console.error('Create bottle error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update bottle
router.put('/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const bottle = req.body;
    await pool.query(
      `UPDATE bottles SET data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(bottle), req.params.id, req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Update bottle error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete bottle
router.delete('/:id', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    await pool.query('DELETE FROM bottles WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete bottle error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
