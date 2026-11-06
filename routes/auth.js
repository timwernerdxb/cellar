const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authRequired } = require('../middleware/auth');

// Register
router.post('/register', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { email, password, name } = req.body;

    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    // Check if email already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (email, name, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [email.toLowerCase().trim(), name || null, passwordHash]
    );
    const user = result.rows[0];

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({ id: user.id, email: user.email, name: user.name });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { email, password } = req.body;

    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const result = await pool.query(
      `SELECT u.id, u.email, u.name, u.password_hash, u.cellar_owner_id,
              o.name AS owner_name, o.email AS owner_email
       FROM users u LEFT JOIN users o ON o.id = u.cellar_owner_id
       WHERE u.email = $1`,
      [email.toLowerCase().trim()]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      isMember: !!user.cellar_owner_id,
      cellarOwner: user.cellar_owner_id ? { name: user.owner_name, email: user.owner_email } : null,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current user
router.get('/me', authRequired, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, o.is_demo AS owner_is_demo, u.is_demo,
              o.name AS owner_name, o.email AS owner_email
       FROM users u LEFT JOIN users o ON o.id = u.cellar_owner_id
       WHERE u.id = $1`,
      [req.loginUserId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      isDemo: !!(user.is_demo || user.owner_is_demo),
      isMember: req.isMember,
      cellarOwner: req.isMember ? { name: user.owner_name, email: user.owner_email } : null,
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Shared access (members) ----
// A member is a separate login that reads and writes this account's cellar.
// Only the cellar owner can manage members; members cannot add members.

function ownerOnly(req, res, next) {
  if (req.isMember) return res.status(403).json({ error: 'Only the cellar owner can manage members' });
  next();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validMemberId(req, res, next) {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Member not found' });
  next();
}

async function rejectDemo(req, res, next) {
  try {
    const pool = req.app.locals.pool;
    const r = await pool.query('SELECT is_demo FROM users WHERE id = $1', [req.userId]);
    if (r.rows[0]?.is_demo) return res.status(403).json({ error: 'Not available on the demo account' });
    next();
  } catch (err) {
    console.error('Demo check error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

router.get('/members', authRequired, ownerOnly, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'SELECT id, email, name, created_at FROM users WHERE cellar_owner_id = $1 ORDER BY created_at',
      [req.userId]
    );
    res.json({ members: result.rows.map(m => ({ id: m.id, email: m.email, name: m.name, createdAt: m.created_at })) });
  } catch (err) {
    console.error('List members error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/members', authRequired, ownerOnly, rejectDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { email, password, name } = req.body;
    const cleanEmail = (email || '').toLowerCase().trim();

    if (!cleanEmail || !password) return res.status(400).json({ error: 'Email and password required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: 'Enter a valid email address' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'That email already has an account' });

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, name, password_hash, cellar_owner_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, created_at`,
      [cleanEmail, (name || '').trim() || null, passwordHash, req.userId]
    );
    const m = result.rows[0];
    res.status(201).json({ id: m.id, email: m.email, name: m.name, createdAt: m.created_at });
  } catch (err) {
    console.error('Add member error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/members/:id/password', authRequired, ownerOnly, validMemberId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND cellar_owner_id = $3',
      [passwordHash, req.params.id, req.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Member not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Reset member password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/members/:id', authRequired, ownerOnly, validMemberId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    // Member rows own no cellar data (everything is written under the owner's id),
    // so deleting the login removes only their access.
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 AND cellar_owner_id = $2',
      [req.params.id, req.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Member not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

module.exports = router;
