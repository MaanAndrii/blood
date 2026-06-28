const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// PUT /api/users/me — update own profile (name, date_of_birth)
router.put('/me', requireAuth, async (req, res) => {
  try {
    const { name, date_of_birth, height_cm } = req.body;
    const sets = [], vals = [];
    let idx = 1;
    if (name !== undefined) {
      const trimmed = name?.trim() || null;
      if (trimmed && trimmed.length > 100) return res.status(400).json({ error: 'name must be 100 characters or less' });
      sets.push(`name = $${idx++}`);
      vals.push(trimmed);
    }
    if (date_of_birth !== undefined) {
      if (date_of_birth && !/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth)) {
        return res.status(400).json({ error: 'date_of_birth must be YYYY-MM-DD' });
      }
      sets.push(`date_of_birth = $${idx++}`);
      vals.push(date_of_birth || null);
    }
    if (height_cm !== undefined) {
      const h = height_cm == null ? null : parseInt(height_cm, 10);
      if (h !== null && (isNaN(h) || h < 50 || h > 250)) {
        return res.status(400).json({ error: 'height_cm must be between 50 and 250' });
      }
      sets.push(`height_cm = $${idx++}`);
      vals.push(h);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.user.id);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, name, date_of_birth, email, avatar_url, is_admin, height_cm`,
      vals
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /api/users/me error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/users — admin only: list all users with activity stats
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, u.avatar_url, u.is_admin,
              u.subscription_tier, u.subscription_expires_at,
              u.date_of_birth, u.created_at,
              COUNT(e.id)::INT AS entry_count,
              MAX(e.date)::TEXT  AS last_entry_date
       FROM users u
       LEFT JOIN entries e ON e.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('GET /api/users error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/users/invite — admin only: pre-register user by email
router.post('/invite', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format' });

    const result = await pool.query(
      `INSERT INTO users (email, name, is_admin)
       VALUES ($1, $2, FALSE)
       ON CONFLICT (email) DO UPDATE SET name = COALESCE(EXCLUDED.name, users.name)
       RETURNING *`,
      [email.toLowerCase().trim(), name || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('POST /api/users/invite error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT /api/users/:id — admin only: update user or pre-register by email
// If :id is 'new' or body has only email, pre-register that email
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Pre-register a new user by email
    if (id === 'new') {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'email required' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format' });

      const result = await pool.query(
        `INSERT INTO users (email, is_admin)
         VALUES ($1, FALSE)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING *`,
        [email.toLowerCase().trim()]
      );
      return res.json(result.rows[0]);
    }

    const userId = parseInt(id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

    const { date_of_birth, is_admin, email, subscription_tier, months } = req.body;

    // Build dynamic update
    const sets = [];
    const vals = [];
    let idx = 1;

    if (date_of_birth !== undefined)    { sets.push(`date_of_birth = $${idx++}`);    vals.push(date_of_birth || null); }
    if (is_admin !== undefined)          { sets.push(`is_admin = $${idx++}`);          vals.push(Boolean(is_admin)); }
    if (email !== undefined) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format' });
      sets.push(`email = $${idx++}`);
      vals.push(email.toLowerCase().trim());
    }
    if (subscription_tier !== undefined) {
      if (!['demo', 'premium'].includes(subscription_tier)) {
        return res.status(400).json({ error: 'subscription_tier must be demo or premium' });
      }
      sets.push(`subscription_tier = $${idx++}`);
      vals.push(subscription_tier);
      if (subscription_tier === 'premium' && months) {
        const exp = new Date();
        exp.setMonth(exp.getMonth() + parseInt(months, 10));
        sets.push(`subscription_expires_at = $${idx++}`);
        vals.push(exp.toISOString());
      } else if (subscription_tier === 'demo') {
        sets.push(`subscription_expires_at = $${idx++}`);
        vals.push(null);
      }
    }

    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });

    vals.push(userId);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );

    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /api/users/:id error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/users/:id/reset-password — admin only: set a new password for any user
router.post('/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

    const { password } = req.body;
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id',
      [hash, userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/users/:id/reset-password error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /api/users/me — delete own account (GDPR right to erasure)
router.delete('/me', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.user.id]);
    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/users/me error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /api/users/:id — admin only: delete user (not self)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id',
      [userId]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/users/:id error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
