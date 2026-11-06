const jwt = require('jsonwebtoken');

// Verifies the session cookie and resolves which cellar the request acts on.
//   req.loginUserId - the account that signed in
//   req.userId      - the cellar owner whose data every route reads/writes
//                     (same as loginUserId unless this account is a member of
//                     someone else's cellar)
//   req.isMember    - true when acting on another user's cellar
async function authRequired(req, res, next) {
  const token = req.cookies?.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query('SELECT cellar_owner_id FROM users WHERE id = $1', [decoded.userId]);
    // Account removed (e.g. owner revoked a member's access) - treat the token as dead
    if (result.rows.length === 0) {
      res.clearCookie('token');
      return res.status(401).json({ error: 'Account no longer exists' });
    }
    req.loginUserId = decoded.userId;
    req.userEmail = decoded.email;
    req.userId = result.rows[0].cellar_owner_id || decoded.userId;
    req.isMember = !!result.rows[0].cellar_owner_id;
    next();
  } catch (err) {
    console.error('Auth lookup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { authRequired };
