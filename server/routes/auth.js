const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { getEffectiveTier } = require('../config/tiers');
const { driveAuthUrl, exchangeCode } = require('../services/drive');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Configure Passport Google Strategy (only if credentials are provided)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) return done(new Error('No email from Google'), null);

      const existing = await pool.query(
        'SELECT * FROM users WHERE google_id = $1 OR email = $2 LIMIT 1',
        [profile.id, email]
      );

      if (!existing.rows.length) {
        return done(null, false, { message: 'access_denied' });
      }

      const result = await pool.query(
        `UPDATE users SET
           google_id = $1,
           name = $2,
           avatar_url = $3
         WHERE id = $4
         RETURNING *`,
        [profile.id, profile.displayName, profile.photos?.[0]?.value, existing.rows[0].id]
      );

      return done(null, result.rows[0]);
    } catch (err) {
      return done(err, null);
    }
  }));
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ── Helpers ──────────────────────────────────────────────────────────────────

function cookieOpts() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

function issueJwt(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// ── Google OAuth ──────────────────────────────────────────────────────────────

router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.redirect('/?error=google_not_configured');
  }
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
});

router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/?error=access_denied' }),
  (req, res) => {
    if (!req.user) return res.redirect('/?error=access_denied');
    const token = issueJwt(req.user);
    res.cookie('token', token, cookieOpts());
    res.redirect('/');
  }
);

// ── Google Drive OAuth ────────────────────────────────────────────────────────

router.get('/google/drive', requireAuth, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_DRIVE_CALLBACK_URL) {
    return res.redirect('/?error=google_drive_not_configured');
  }
  res.redirect(driveAuthUrl(req.user.id));
});

router.get('/google/drive/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code || !state) return res.redirect('/?error=drive_denied');

  try {
    const userId = parseInt(Buffer.from(state, 'base64').toString(), 10);
    if (!userId) return res.redirect('/?error=drive_bad_state');

    const tokens = await exchangeCode(code);
    if (!tokens.access_token) return res.redirect('/?error=drive_token_failed');

    await pool.query(
      `UPDATE users SET
         drive_access_token=$1,
         drive_refresh_token=COALESCE($2, drive_refresh_token),
         drive_token_expires_at=$3
       WHERE id=$4`,
      [
        tokens.access_token,
        tokens.refresh_token || null,
        tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
        userId,
      ]
    );

    res.redirect('/?drive_connected=1');
  } catch (err) {
    console.error('Drive OAuth callback error:', err);
    res.redirect('/?error=drive_callback_failed');
  }
});

// ── Local Register ────────────────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, consented } = req.body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: "Введіть ім'я" });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Невірний формат email' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Пароль має містити мінімум 8 символів' });
    }
    if (!consented) {
      return res.status(400).json({ error: 'Необхідна згода на обробку персональних даних' });
    }

    const exists = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length) {
      return res.status(409).json({ error: 'Цей email вже зареєстрований' });
    }

    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, name, password_hash, subscription_tier, subscription_expires_at, is_admin, consented_at)
       VALUES ($1, $2, $3, 'premium', NOW() + interval '7 days', FALSE, NOW())
       RETURNING *`,
      [email.toLowerCase(), name.trim(), hash]
    );

    const token = issueJwt(result.rows[0]);
    res.cookie('token', token, cookieOpts());
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/register error:', err);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// ── Local Login ───────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: 'Введіть email і пароль' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Невірний email або пароль' });
    }

    const user = result.rows[0];
    if (!user.password_hash) {
      return res.status(401).json({ error: 'Цей акаунт використовує вхід через Google' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Невірний email або пароль' });
    }

    const token = issueJwt(user);
    res.cookie('token', token, cookieOpts());
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/login error:', err);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  res.json({ ok: true });
});

// ── Me ────────────────────────────────────────────────────────────────────────

router.get('/me', async (req, res) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const result = await pool.query(
      `SELECT id, email, name, avatar_url, is_admin, date_of_birth, created_at,
              subscription_tier, subscription_expires_at,
              reminders_enabled, reminder_morning, reminder_evening,
              height_cm, timezone
       FROM users WHERE id = $1`,
      [payload.id]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'User not found' });
    const user = result.rows[0];
    res.json({ ...user, effective_tier: getEffectiveTier(user) });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
