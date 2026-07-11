const express = require('express');
const { pool } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { buildSystemBackup, restoreSystemBackup } = require('../utils/backupData');

const router = express.Router();

// ── Full-system backup / restore (admin only) ────────────────────────────────
// GET /api/users/admin/backup — download ALL users + entries + labs as JSON
router.get('/admin/backup', requireAuth, requireAdmin, async (req, res) => {
  try {
    const backup = await buildSystemBackup();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition',
      `attachment; filename="system_backup_${new Date().toISOString().slice(0, 10)}.json"`);
    res.send(JSON.stringify(backup));
  } catch (err) {
    console.error('GET /api/users/admin/backup error:', err);
    res.status(500).json({ error: 'Backup failed' });
  }
});

// POST /api/users/admin/restore — restore a full-system backup (large body)
router.post('/admin/restore', requireAuth, requireAdmin, express.json({ limit: '50mb' }), async (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object' || !Array.isArray(data.users)) {
      return res.status(400).json({ error: 'Invalid backup file' });
    }
    const result = await restoreSystemBackup(data);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('POST /api/users/admin/restore error:', err);
    res.status(500).json({ error: 'Restore failed' });
  }
});

// PUT /api/users/me — update own profile (name, date_of_birth)
router.put('/me', requireAuth, async (req, res) => {
  try {
    const {
      name, date_of_birth, height_cm,
      sex, smoker, diabetic, on_bp_meds,
      total_cholesterol, hdl_cholesterol,
    } = req.body;
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
    if (sex !== undefined) {
      if (sex !== null && sex !== 'male' && sex !== 'female') {
        return res.status(400).json({ error: 'sex must be male, female or null' });
      }
      sets.push(`sex = $${idx++}`);
      vals.push(sex || null);
    }
    for (const [key, val] of [['smoker', smoker], ['diabetic', diabetic], ['on_bp_meds', on_bp_meds]]) {
      if (val === undefined) continue;
      if (val !== null && typeof val !== 'boolean') {
        return res.status(400).json({ error: `${key} must be a boolean or null` });
      }
      sets.push(`${key} = $${idx++}`);
      vals.push(val);
    }
    // Cholesterol (mmol/L). Update the measurement timestamp whenever either value changes.
    let cholTouched = false;
    if (total_cholesterol !== undefined) {
      const c = total_cholesterol == null || total_cholesterol === '' ? null : Number(total_cholesterol);
      if (c !== null && (isNaN(c) || c < 1 || c > 20)) {
        return res.status(400).json({ error: 'total_cholesterol must be between 1 and 20 mmol/L' });
      }
      sets.push(`total_cholesterol = $${idx++}`);
      vals.push(c);
      cholTouched = true;
    }
    if (hdl_cholesterol !== undefined) {
      const c = hdl_cholesterol == null || hdl_cholesterol === '' ? null : Number(hdl_cholesterol);
      if (c !== null && (isNaN(c) || c < 0.3 || c > 5)) {
        return res.status(400).json({ error: 'hdl_cholesterol must be between 0.3 and 5 mmol/L' });
      }
      sets.push(`hdl_cholesterol = $${idx++}`);
      vals.push(c);
      cholTouched = true;
    }
    if (cholTouched) sets.push(`cholesterol_updated_at = NOW()`);
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.user.id);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx}
       RETURNING id, name, date_of_birth, email, avatar_url, height_cm,
                 sex, smoker, diabetic, on_bp_meds,
                 total_cholesterol, hdl_cholesterol, cholesterol_updated_at`,
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
      `SELECT u.id, u.email, u.name, u.avatar_url,
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
      `INSERT INTO users (email, name)
       VALUES ($1, $2)
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
        `INSERT INTO users (email)
         VALUES ($1)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING *`,
        [email.toLowerCase().trim()]
      );
      return res.json(result.rows[0]);
    }

    const userId = parseInt(id, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' });

    const { date_of_birth, email, subscription_tier, months } = req.body;

    // Prevent demoting the last admin
    if (subscription_tier && subscription_tier !== 'admin') {
      const targetRes = await pool.query('SELECT subscription_tier FROM users WHERE id = $1', [userId]);
      if (targetRes.rows[0]?.subscription_tier === 'admin') {
        const adminCount = await pool.query(`SELECT COUNT(*) FROM users WHERE subscription_tier = 'admin'`);
        if (parseInt(adminCount.rows[0].count, 10) <= 1) {
          return res.status(400).json({ error: 'Неможливо понизити останнього адміна' });
        }
      }
    }

    // Build dynamic update
    const sets = [];
    const vals = [];
    let idx = 1;

    if (date_of_birth !== undefined) { sets.push(`date_of_birth = $${idx++}`); vals.push(date_of_birth || null); }
    if (email !== undefined) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format' });
      sets.push(`email = $${idx++}`);
      vals.push(email.toLowerCase().trim());
    }
    if (subscription_tier !== undefined) {
      const validTiers = ['admin', 'demo', 'free', 'premium'];
      if (!validTiers.includes(subscription_tier)) {
        return res.status(400).json({ error: 'subscription_tier must be admin, demo, free, or premium' });
      }
      sets.push(`subscription_tier = $${idx++}`);
      vals.push(subscription_tier);
      if (subscription_tier === 'premium' && months) {
        const exp = new Date();
        exp.setMonth(exp.getMonth() + parseInt(months, 10));
        sets.push(`subscription_expires_at = $${idx++}`);
        vals.push(exp.toISOString());
      } else {
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

// POST /api/users/me/change-password — authenticated user changes their own password
router.post('/me/change-password', requireAuth, async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { current_password, new_password } = req.body ?? {};

    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'Новий пароль має містити мінімум 8 символів' });
    }

    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];

    if (user.password_hash) {
      if (!current_password) {
        return res.status(400).json({ error: 'Введіть поточний пароль' });
      }
      const valid = await bcrypt.compare(current_password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Невірний поточний пароль' });
    }

    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/users/me/change-password error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /api/users/me — delete own account (GDPR right to erasure)
router.delete('/me', requireAuth, async (req, res) => {
  try {
    const selfRes = await pool.query('SELECT subscription_tier FROM users WHERE id = $1', [req.user.id]);
    if (selfRes.rows[0]?.subscription_tier === 'admin') {
      const adminCount = await pool.query(`SELECT COUNT(*) FROM users WHERE subscription_tier = 'admin'`);
      if (parseInt(adminCount.rows[0].count, 10) <= 1) {
        return res.status(400).json({ error: 'Останній адмін не може видалити свій акаунт' });
      }
    }
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

    const targetRes = await pool.query('SELECT subscription_tier FROM users WHERE id = $1', [userId]);
    if (targetRes.rows[0]?.subscription_tier === 'admin') {
      const adminCount = await pool.query(`SELECT COUNT(*) FROM users WHERE subscription_tier = 'admin'`);
      if (parseInt(adminCount.rows[0].count, 10) <= 1) {
        return res.status(400).json({ error: 'Неможливо видалити останнього адміна' });
      }
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
