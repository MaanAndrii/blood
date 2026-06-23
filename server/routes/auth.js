const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const router = express.Router();

// Configure Passport Google Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL,
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails?.[0]?.value;
    if (!email) return done(new Error('No email from Google'), null);

    // Check if any users exist
    const countResult = await pool.query('SELECT COUNT(*) FROM users');
    const userCount = parseInt(countResult.rows[0].count, 10);

    if (userCount === 0) {
      // First user ever — create as admin
      const result = await pool.query(
        `INSERT INTO users (email, name, avatar_url, google_id, refresh_token, is_admin)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (email) DO UPDATE SET
           google_id = EXCLUDED.google_id,
           name = EXCLUDED.name,
           avatar_url = EXCLUDED.avatar_url,
           refresh_token = EXCLUDED.refresh_token,
           is_admin = TRUE
         RETURNING *`,
        [
          email,
          profile.displayName,
          profile.photos?.[0]?.value,
          profile.id,
          refreshToken,
        ]
      );
      return done(null, result.rows[0]);
    }

    // Check if user exists (by google_id or email)
    const existing = await pool.query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2 LIMIT 1',
      [profile.id, email]
    );

    if (!existing.rows.length) {
      // User not registered — deny access
      return done(null, false, { message: 'access_denied' });
    }

    // Update user info
    const result = await pool.query(
      `UPDATE users SET
         google_id = $1,
         name = $2,
         avatar_url = $3,
         refresh_token = $4
       WHERE id = $5
       RETURNING *`,
      [
        profile.id,
        profile.displayName,
        profile.photos?.[0]?.value,
        refreshToken,
        existing.rows[0].id,
      ]
    );

    return done(null, result.rows[0]);
  } catch (err) {
    return done(err, null);
  }
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Cookie settings helper
function cookieOpts() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  };
}

function issueJwt(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      is_admin: user.is_admin,
    },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// GET /api/auth/google
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
  session: false,
}));

// GET /api/auth/google/callback
router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/?error=access_denied' }),
  (req, res) => {
    if (!req.user) {
      return res.redirect('/?error=access_denied');
    }
    const token = issueJwt(req.user);
    res.cookie('token', token, cookieOpts());
    res.redirect('/');
  }
);

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query(
      `SELECT id, email, name, avatar_url, is_admin, date_of_birth, created_at,
              reminders_enabled, reminder_morning, reminder_evening
       FROM users WHERE id = $1`,
      [payload.id]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
