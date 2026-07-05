const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const num = v => (v !== null ? parseFloat(v) : null);
function rowToLab(row) {
  return {
    date: String(row.date).slice(0, 10),
    hba1c:         num(row.hba1c),
    total_chol:    num(row.total_chol),
    hdl:           num(row.hdl),
    ldl:           num(row.ldl),
    triglycerides: num(row.triglycerides),
    saved: row.updated_at,
  };
}

// Field validation ranges (mmol/L except hba1c in %)
const RANGES = {
  hba1c:         [3, 20],
  total_chol:    [1, 20],
  hdl:           [0.3, 5],
  ldl:           [0.3, 15],
  triglycerides: [0.2, 30],
};

function parseField(key, val) {
  if (val === undefined || val === null || val === '') return { ok: true, value: null };
  const n = Number(val);
  const [lo, hi] = RANGES[key];
  if (isNaN(n) || n < lo || n > hi) {
    return { ok: false, error: `${key} must be between ${lo} and ${hi}` };
  }
  return { ok: true, value: n };
}

// GET /api/labs — all lab panels for current user, newest first
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM lab_results WHERE user_id = $1 ORDER BY date DESC',
      [req.user.id]
    );
    res.json(result.rows.map(rowToLab));
  } catch (err) {
    console.error('GET /api/labs error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/labs — create/replace the panel for a given date
router.post('/', requireAuth, async (req, res) => {
  try {
    const { date } = req.body ?? {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const fields = {};
    for (const key of Object.keys(RANGES)) {
      const r = parseField(key, req.body[key]);
      if (!r.ok) return res.status(400).json({ error: r.error });
      fields[key] = r.value;
    }
    if (Object.values(fields).every(v => v === null)) {
      return res.status(400).json({ error: 'At least one value is required' });
    }
    const result = await pool.query(
      `INSERT INTO lab_results (user_id, date, hba1c, total_chol, hdl, ldl, triglycerides)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, date) DO UPDATE SET
         hba1c = EXCLUDED.hba1c,
         total_chol = EXCLUDED.total_chol,
         hdl = EXCLUDED.hdl,
         ldl = EXCLUDED.ldl,
         triglycerides = EXCLUDED.triglycerides,
         updated_at = NOW()
       RETURNING *`,
      [req.user.id, date, fields.hba1c, fields.total_chol, fields.hdl, fields.ldl, fields.triglycerides]
    );
    res.json(rowToLab(result.rows[0]));
  } catch (err) {
    console.error('POST /api/labs error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /api/labs/:date — remove a dated panel
router.delete('/:date', requireAuth, async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date' });
    }
    const result = await pool.query(
      'DELETE FROM lab_results WHERE user_id = $1 AND date = $2 RETURNING id',
      [req.user.id, date]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/labs/:date error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
