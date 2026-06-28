const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../db');
const { getEffectiveTier } = require('../config/tiers');
const { driveAuthUrl, exchangeCode } = require('../services/drive');
const { sendResetEmail } = require('../services/email');
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

      if (existing.rows.length) {
        // Existing user — update Google profile info
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
      }

      // New user — auto-register; first ever user gets admin rights
      const countRes = await pool.query('SELECT COUNT(*) FROM users');
      const isAdmin = parseInt(countRes.rows[0].count, 10) === 0;

      const result = await pool.query(
        `INSERT INTO users
           (email, name, avatar_url, google_id, subscription_tier, subscription_expires_at, is_admin, consented_at)
         VALUES ($1, $2, $3, $4, 'premium', NOW() + interval '7 days', $5, NOW())
         RETURNING *`,
        [email, profile.displayName, profile.photos?.[0]?.value, profile.id, isAdmin]
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
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function issueJwt(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ── Google OAuth ──────────────────────────────────────────────────────────────

router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.redirect('/?error=google_not_configured');
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
  });
  passport.authenticate('google', { scope: ['profile', 'email'], session: false, state })(req, res, next);
});

router.get('/google/callback',
  (req, res, next) => {
    const state = req.query.state;
    const cookieState = req.cookies?.oauth_state;
    res.clearCookie('oauth_state', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
    if (!state || !cookieState || state !== cookieState) {
      return res.redirect('/?error=access_denied');
    }
    next();
  },
  passport.authenticate('google', { session: false, failureRedirect: '/?error=access_denied' }),
  (req, res) => {
    if (!req.user) return res.redirect('/?error=access_denied');
    const token = issueJwt(req.user);
    res.cookie('token', token, cookieOpts());
    res.redirect('/app');
  }
);

// ── Google Drive OAuth ────────────────────────────────────────────────────────

router.get('/google/drive', requireAuth, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.redirect('/?error=drive_no_client_id');
  if (!process.env.GOOGLE_DRIVE_CALLBACK_URL) return res.redirect('/?error=drive_no_callback_url');
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

// ── Forgot password ───────────────────────────────────────────────────────────

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body ?? {};
    if (!email) return res.status(400).json({ error: 'email required' });

    const result = await pool.query(
      'SELECT id, email FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length) {
      const user = result.rows[0];
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [user.id, tokenHash, expiresAt]
      );

      const appUrl = process.env.APP_URL || 'https://bpbmi.pp.ua';
      const resetLink = `${appUrl}/reset-password?token=${rawToken}`;
      sendResetEmail(user.email, resetLink).catch(err =>
        console.error('[email] sendResetEmail failed:', err.message)
      );
    }

    // Always respond OK — never reveal whether email exists
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/forgot-password error:', err);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

// ── Reset password (from email token) ────────────────────────────────────────

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body ?? {};
    if (!token || !password) {
      return res.status(400).json({ error: 'token and password required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Пароль має містити мінімум 8 символів' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await pool.query(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [tokenHash]
    );
    if (!result.rows.length) {
      return res.status(400).json({ error: 'Посилання недійсне або вже використане' });
    }

    const { id: tokenId, user_id } = result.rows[0];
    const hash = await bcrypt.hash(password, 10);

    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user_id]);
    await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [tokenId]);

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/reset-password error:', err);
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
              height_cm, timezone,
              (password_hash IS NOT NULL) AS has_password
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
