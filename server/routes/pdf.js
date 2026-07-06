const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { generatePdf } = require('../services/pdf');
const { getEffectiveTier } = require('../config/tiers');

const router = express.Router();

// POST /api/pdf — generate PDF report
router.post('/', requireAuth, async (req, res) => {
  try {
    let { userId, dateFrom, dateTo, mode } = req.body;
    if (mode !== 'extended') mode = 'short';

    // Only admins can generate reports for other users
    if (userId && userId !== req.user.id) {
      const requesterRes = await pool.query('SELECT subscription_tier FROM users WHERE id = $1', [req.user.id]);
      if (requesterRes.rows[0]?.subscription_tier !== 'admin') {
        return res.status(403).json({ error: 'Admin access required to generate reports for other users' });
      }
    } else {
      userId = req.user.id;
    }

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom and dateTo are required' });
    }

    // Get user info + tier
    const userResult = await pool.query(
      'SELECT id, name, date_of_birth, sex, subscription_tier, subscription_expires_at FROM users WHERE id = $1',
      [userId]
    );
    if (!userResult.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = userResult.rows[0];

    // Block PDF for demo tier (unless admin generating for another user)
    if (userId === req.user.id && getEffectiveTier(user) === 'demo') {
      return res.status(403).json({ error: 'PDF export not available on Demo plan' });
    }

    // Get entries for the date range
    const entriesResult = await pool.query(
      `SELECT * FROM entries
       WHERE user_id = $1 AND date >= $2 AND date <= $3
       ORDER BY date ASC`,
      [userId, dateFrom, dateTo]
    );

    // Get all lab panels (for the extended report's lab section)
    const labsResult = await pool.query(
      `SELECT date, hba1c, total_chol, hdl, ldl, triglycerides
       FROM lab_results WHERE user_id = $1 ORDER BY date ASC`,
      [userId]
    );

    const pdfBuffer = await generatePdf(user, entriesResult.rows, labsResult.rows, dateFrom, dateTo, mode);

    const filename = `health_report_${dateFrom}_${dateTo}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('POST /api/pdf error:', err);
    res.status(500).json({ error: 'PDF generation failed' });
  }
});

module.exports = router;
