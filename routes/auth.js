const router = require('express').Router();
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const { authRequired } = require('../middleware/auth');

// Conditionally load Apple strategy
let AppleStrategy;
try { AppleStrategy = require('passport-apple'); } catch { /* not installed or not configured */ }

// ---- Google OAuth ----
if (process.env.GOOGLE_CLIENT_ID) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
  }, (accessToken, refreshToken, profile, done) => {
    done(null, {
      provider: 'google',
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      name: profile.displayName,
      picture: profile.photos?.[0]?.value,
    });
  }));
}

// ---- Apple Sign In ----
if (AppleStrategy && process.env.APPLE_CLIENT_ID) {
  passport.use(new AppleStrategy({
    clientID: process.env.APPLE_CLIENT_ID,
    teamID: process.env.APPLE_TEAM_ID,
    keyID: process.env.APPLE_KEY_ID,
    privateKeyString: (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    callbackURL: process.env.APPLE_CALLBACK_URL,
    scope: ['name', 'email'],
  }, (accessToken, refreshToken, idToken, profile, done) => {
    done(null, {
      provider: 'apple',
      providerId: profile.id || idToken?.sub,
      email: profile.email || idToken?.email,
      name: profile.name ? `${profile.name.firstName || ''} ${profile.name.lastName || ''}`.trim() : null,
      picture: null,
    });
  }));
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

router.use(passport.initialize());

// Shared: upsert user + issue JWT cookie + redirect
async function handleAuthCallback(req, res) {
  try {
    const pool = req.app.locals.pool;
    const { provider, providerId, email, name, picture } = req.user;

    // Use email as unique key (works across providers)
    const result = await pool.query(
      `INSERT INTO users (google_id, email, name, picture)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET
         name = COALESCE(NULLIF($3, ''), users.name),
         picture = COALESCE($4, users.picture),
         google_id = COALESCE($1, users.google_id),
         updated_at = NOW()
       RETURNING id, email, name, picture`,
      [`${provider}:${providerId}`, email, name, picture]
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

    res.redirect('/#authenticated');
  } catch (err) {
    console.error('Auth callback error:', err);
    res.redirect('/?auth=error');
  }
}

// Google routes
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'], session: false }));
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/?auth=failed' }),
  handleAuthCallback
);

// Apple routes (POST callback — Apple sends form data)
router.get('/apple', passport.authenticate('apple', { session: false }));
router.post('/apple/callback',
  passport.authenticate('apple', { session: false, failureRedirect: '/?auth=failed' }),
  handleAuthCallback
);

// Get current user
router.get('/me', authRequired, async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const result = await pool.query(
      'SELECT id, email, name, picture FROM users WHERE id = $1',
      [req.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Check which auth providers are configured
router.get('/providers', (req, res) => {
  res.json({
    google: !!process.env.GOOGLE_CLIENT_ID,
    apple: !!process.env.APPLE_CLIENT_ID,
  });
});

// Logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

module.exports = router;
