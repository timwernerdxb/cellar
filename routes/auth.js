const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { authRequired } = require('../middleware/auth');
const { sendMail, isEmailConfigured, inviteEmail } = require('../lib/email');

const INVITE_DAYS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setSessionCookie(res, user) {
  const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

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
    const members = await pool.query(
      'SELECT id, email, name, created_at FROM users WHERE cellar_owner_id = $1 ORDER BY created_at',
      [req.userId]
    );
    const invites = await pool.query(
      `SELECT id, email, token, expires_at, created_at FROM cellar_invites
       WHERE owner_id = $1 AND accepted_at IS NULL AND expires_at > NOW()
       ORDER BY created_at`,
      [req.userId]
    );
    const base = appUrl(req);
    res.json({
      members: members.rows.map(m => ({ id: m.id, email: m.email, name: m.name, createdAt: m.created_at })),
      invites: invites.rows.map(i => ({
        id: i.id, email: i.email, link: `${base}/invite/${i.token}`, expiresAt: i.expires_at, createdAt: i.created_at,
      })),
      emailConfigured: isEmailConfigured(),
    });
  } catch (err) {
    console.error('List members error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

async function deliverInvite(req, invite) {
  const pool = req.app.locals.pool;
  const owner = await pool.query('SELECT name, email FROM users WHERE id = $1', [req.userId]);
  const ownerName = owner.rows[0]?.name || owner.rows[0]?.email;
  const link = `${appUrl(req)}/invite/${invite.token}`;
  const mail = inviteEmail({ ownerName, link, expiresDays: INVITE_DAYS });
  const result = await sendMail({ to: invite.email, ...mail });
  return { link, emailSent: result.sent, emailReason: result.reason || null };
}

function inviteJson(i, link) {
  return { id: i.id, email: i.email, link, expiresAt: i.expires_at, createdAt: i.created_at };
}

// Create (or refresh) an invitation and email it when mail is configured.
router.post('/invites', authRequired, ownerOnly, rejectDemo, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });

    const existing = await pool.query('SELECT id, cellar_owner_id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      const already = existing.rows[0].cellar_owner_id === req.userId;
      return res.status(409).json({ error: already ? 'That person already has access' : 'That email already has its own account' });
    }

    // One live invite per email per cellar: a new invite replaces the old link.
    await pool.query('DELETE FROM cellar_invites WHERE owner_id = $1 AND email = $2 AND accepted_at IS NULL', [req.userId, email]);
    const token = crypto.randomBytes(32).toString('base64url');
    const result = await pool.query(
      `INSERT INTO cellar_invites (owner_id, email, token, expires_at)
       VALUES ($1, $2, $3, NOW() + ($4 || ' days')::interval)
       RETURNING id, email, token, expires_at, created_at`,
      [req.userId, email, token, String(INVITE_DAYS)]
    );
    const invite = result.rows[0];
    const delivery = await deliverInvite(req, invite);
    res.status(201).json({ invite: inviteJson(invite, delivery.link), emailSent: delivery.emailSent, emailReason: delivery.emailReason });
  } catch (err) {
    console.error('Create invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Send the invitation email again (same link, expiry extended).
router.post('/invites/:id/resend', authRequired, ownerOnly, validMemberId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      `UPDATE cellar_invites SET expires_at = NOW() + ($3 || ' days')::interval
       WHERE id = $1 AND owner_id = $2 AND accepted_at IS NULL
       RETURNING id, email, token, expires_at, created_at`,
      [req.params.id, req.userId, String(INVITE_DAYS)]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Invitation not found' });
    const invite = result.rows[0];
    const delivery = await deliverInvite(req, invite);
    res.json({ invite: inviteJson(invite, delivery.link), emailSent: delivery.emailSent, emailReason: delivery.emailReason });
  } catch (err) {
    console.error('Resend invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/invites/:id', authRequired, ownerOnly, validMemberId, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'DELETE FROM cellar_invites WHERE id = $1 AND owner_id = $2',
      [req.params.id, req.userId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Invitation not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Revoke invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ---- Public: the invitee's side ----

const TOKEN_RE = /^[A-Za-z0-9_-]{20,}$/;

async function findLiveInvite(pool, token) {
  if (!TOKEN_RE.test(token)) return null;
  const result = await pool.query(
    `SELECT i.id, i.email, i.owner_id, i.expires_at, i.accepted_at, o.name AS owner_name, o.email AS owner_email
     FROM cellar_invites i JOIN users o ON o.id = i.owner_id
     WHERE i.token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

router.get('/invites/:token', async (req, res) => {
  try {
    const invite = await findLiveInvite(req.app.locals.pool, req.params.token);
    if (!invite) return res.status(404).json({ error: 'This invitation link is not valid' });
    if (invite.accepted_at) return res.status(410).json({ error: 'This invitation has already been used. Sign in with your email and password.' });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'This invitation has expired. Ask for a new one.' });
    res.json({ email: invite.email, ownerName: invite.owner_name || invite.owner_email, expiresAt: invite.expires_at });
  } catch (err) {
    console.error('Read invite error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/invites/:token/accept', async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const { name, password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const invite = await findLiveInvite(pool, req.params.token);
    if (!invite) return res.status(404).json({ error: 'This invitation link is not valid' });
    if (invite.accepted_at) return res.status(410).json({ error: 'This invitation has already been used. Sign in with your email and password.' });
    if (new Date(invite.expires_at) < new Date()) return res.status(410).json({ error: 'This invitation has expired. Ask for a new one.' });

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [invite.email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'That email already has an account. Sign in instead.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const client = await pool.connect();
    let user;
    try {
      await client.query('BEGIN');
      const created = await client.query(
        `INSERT INTO users (email, name, password_hash, cellar_owner_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, name`,
        [invite.email, (name || '').trim() || null, passwordHash, invite.owner_id]
      );
      user = created.rows[0];
      await client.query('UPDATE cellar_invites SET accepted_at = NOW() WHERE id = $1', [invite.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    setSessionCookie(res, user);
    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      isMember: true,
      cellarOwner: { name: invite.owner_name, email: invite.owner_email },
    });
  } catch (err) {
    console.error('Accept invite error:', err);
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
