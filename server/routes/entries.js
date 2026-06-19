const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Convert DB row to API format
function rowToEntry(row) {
  return {
    date: String(row.date).slice(0, 10),
    morning: {
      sys_l: row.m_sys_l,
      dia_l: row.m_dia_l,
      sys_r: row.m_sys_r,
      dia_r: row.m_dia_r,
      pulse: row.m_pulse,
    },
    evening: {
      sys_l: row.e_sys_l,
      dia_l: row.e_dia_l,
      sys_r: row.e_sys_r,
      dia_r: row.e_dia_r,
      pulse: row.e_pulse,
    },
    weight: row.weight !== null ? parseFloat(row.weight) : null,
    notes: row.notes,
    saved: row.updated_at,
  };
}

// GET /api/entries — all entries for current user, sorted desc
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM entries WHERE user_id = $1 ORDER BY date DESC`,
      [req.user.id]
    );
    res.json(result.rows.map(rowToEntry));
  } catch (err) {
    console.error('GET /api/entries error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/entries — upsert entry by date
router.post('/', requireAuth, async (req, res) => {
  try {
    const { date, morning = {}, evening = {}, weight, notes } = req.body;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const result = await pool.query(
      `INSERT INTO entries (
        user_id, date,
        m_sys_l, m_dia_l, m_sys_r, m_dia_r, m_pulse,
        e_sys_l, e_dia_l, e_sys_r, e_dia_r, e_pulse,
        weight, notes, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
      ON CONFLICT (user_id, date) DO UPDATE SET
        m_sys_l = COALESCE(EXCLUDED.m_sys_l, entries.m_sys_l),
        m_dia_l = COALESCE(EXCLUDED.m_dia_l, entries.m_dia_l),
        m_sys_r = COALESCE(EXCLUDED.m_sys_r, entries.m_sys_r),
        m_dia_r = COALESCE(EXCLUDED.m_dia_r, entries.m_dia_r),
        m_pulse = COALESCE(EXCLUDED.m_pulse, entries.m_pulse),
        e_sys_l = COALESCE(EXCLUDED.e_sys_l, entries.e_sys_l),
        e_dia_l = COALESCE(EXCLUDED.e_dia_l, entries.e_dia_l),
        e_sys_r = COALESCE(EXCLUDED.e_sys_r, entries.e_sys_r),
        e_dia_r = COALESCE(EXCLUDED.e_dia_r, entries.e_dia_r),
        e_pulse = COALESCE(EXCLUDED.e_pulse, entries.e_pulse),
        weight  = COALESCE(EXCLUDED.weight,  entries.weight),
        notes   = COALESCE(EXCLUDED.notes,   entries.notes),
        updated_at = NOW()
      RETURNING *`,
      [
        req.user.id,
        date,
        morning.sys_l ?? null,
        morning.dia_l ?? null,
        morning.sys_r ?? null,
        morning.dia_r ?? null,
        morning.pulse ?? null,
        evening.sys_l ?? null,
        evening.dia_l ?? null,
        evening.sys_r ?? null,
        evening.dia_r ?? null,
        evening.pulse ?? null,
        weight ?? null,
        notes ?? null,
      ]
    );

    res.json(rowToEntry(result.rows[0]));
  } catch (err) {
    console.error('POST /api/entries error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /api/entries/:date — delete entry by date (YYYY-MM-DD)
router.delete('/:date', requireAuth, async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const result = await pool.query(
      'DELETE FROM entries WHERE user_id = $1 AND date = $2 RETURNING id',
      [req.user.id, date]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/entries/:date error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
