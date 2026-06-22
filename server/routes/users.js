const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// PUT /api/users/me — update own profile (name, date_of_birth)
router.put('/me', requireAuth, async (req, res) => {
  try {
    const { name, date_of_birth } = req.body;
    const sets = [], vals = [];
    let idx = 1;
    if (name !== undefined)          { sets.push(`name = $${idx++}`);          vals.push(name?.trim() || null); }
    if (date_of_birth !== undefined) { sets.push(`date_of_birth = $${idx++}`); vals.push(date_of_birth || null); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.user.id);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, name, date_of_birth, email, avatar_url, is_admin`,
      vals
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('PUT /api/users/me error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/users — admin only: list all users
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, name, avatar_url, is_admin, subscription_tier,
              date_of_birth, reminders_enabled, reminder_morning, reminder_evening,
              created_at
       FROM users ORDER BY created_at ASC`
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

    const { date_of_birth, is_admin, email } = req.body;

    // Build dynamic update
    const sets = [];
    const vals = [];
    let idx = 1;

    if (date_of_birth !== undefined) { sets.push(`date_of_birth = $${idx++}`); vals.push(date_of_birth || null); }
    if (is_admin !== undefined)      { sets.push(`is_admin = $${idx++}`);      vals.push(Boolean(is_admin)); }
    if (email !== undefined)         { sets.push(`email = $${idx++}`);         vals.push(email.toLowerCase().trim()); }

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
