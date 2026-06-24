const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// PUT /api/push/settings — save push subscription + reminder times
router.put('/settings', requireAuth, async (req, res) => {
  try {
    const { subscription, morning, evening, enabled, timezone } = req.body;

    const updates = [];
    const values = [];
    let idx = 1;

    if (subscription !== undefined) {
      updates.push(`push_subscription = $${idx++}`);
      values.push(subscription ? JSON.stringify(subscription) : null);
    }
    if (morning !== undefined) {
      if (morning && !/^\d{2}:\d{2}$/.test(morning)) return res.status(400).json({ error: 'morning must be HH:MM' });
      updates.push(`reminder_morning = $${idx++}`);
      values.push(morning);
    }
    if (evening !== undefined) {
      if (evening && !/^\d{2}:\d{2}$/.test(evening)) return res.status(400).json({ error: 'evening must be HH:MM' });
      updates.push(`reminder_evening = $${idx++}`);
      values.push(evening);
    }
    if (enabled !== undefined) {
      updates.push(`reminders_enabled = $${idx++}`);
      values.push(Boolean(enabled));
    }
    if (timezone !== undefined) {
      try { Intl.DateTimeFormat(undefined, { timeZone: timezone }); } catch {
        return res.status(400).json({ error: 'Invalid timezone' });
      }
      updates.push(`timezone = $${idx++}`);
      values.push(timezone);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    values.push(req.user.id);
    await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/push/settings error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/push/vapid-public-key — return VAPID public key for client subscription
router.get('/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) return res.status(404).json({ error: 'VAPID not configured' });
  res.json({ publicKey: key });
});

module.exports = router;
