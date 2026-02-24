const router = require('express').Router();
const { authRequired } = require('../middleware/auth');

router.use(authRequired);

// Get user settings
router.get('/', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query('SELECT openai_key FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ hasOpenaiKey: !!result.rows[0].openai_key, openaiKey: result.rows[0].openai_key || null });
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update OpenAI key
router.put('/openai-key', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { key } = req.body;
    await pool.query('UPDATE users SET openai_key = $1, updated_at = NOW() WHERE id = $2', [key || null, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Update key error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
