const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getTierConfig } = require('../config/tiers');
const { uploadBackup, listBackups, downloadBackup } = require('../services/drive');

async function requireDriveTier(req, res, next) {
  const { rows } = await pool.query(
    'SELECT subscription_tier, subscription_expires_at FROM users WHERE id=$1',
    [req.user.id]
  );
  if (!getTierConfig(rows[0]).drive_backup) {
    return res.status(403).json({ error: 'demo_restricted' });
  }
  next();
}

const router = express.Router();

// Check Drive connection status
router.get('/drive/status', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT drive_refresh_token IS NOT NULL AND drive_refresh_token <> \'\' AS connected FROM users WHERE id=$1',
      [req.user.id]
    );
    res.json({ connected: rows[0]?.connected ?? false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect Drive
router.delete('/drive', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET drive_access_token=NULL, drive_refresh_token=NULL, drive_token_expires_at=NULL WHERE id=$1',
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create backup
router.post('/drive', requireAuth, requireDriveTier, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT date,
              m_sys_l, m_dia_l, m_sys_r, m_dia_r, m_pulse, m_pulse_l, m_pulse_r,
              e_sys_l, e_dia_l, e_sys_r, e_dia_r, e_pulse, e_pulse_l, e_pulse_r,
              weight, notes
       FROM entries WHERE user_id=$1 ORDER BY date DESC`,
      [req.user.id]
    );

    const entries = rows.map(r => ({
      date:    String(r.date).slice(0, 10),
      morning: { sys_l: r.m_sys_l, dia_l: r.m_dia_l, sys_r: r.m_sys_r, dia_r: r.m_dia_r,
                 pulse: r.m_pulse, pulse_l: r.m_pulse_l, pulse_r: r.m_pulse_r },
      evening: { sys_l: r.e_sys_l, dia_l: r.e_dia_l, sys_r: r.e_sys_r, dia_r: r.e_dia_r,
                 pulse: r.e_pulse, pulse_l: r.e_pulse_l, pulse_r: r.e_pulse_r },
      weight:  r.weight !== null ? parseFloat(r.weight) : null,
      notes:   r.notes || null,
    }));

    const result = await uploadBackup(req.user.id, {
      version:  2,
      exported: new Date().toISOString(),
      entries,
    });

    res.json({ ok: true, ...result, count: entries.length });
  } catch (err) {
    if (err.code === 'not_connected') return res.status(403).json({ error: 'not_connected' });
    console.error('Drive backup error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List available backups on Drive
router.get('/drive/list', requireAuth, requireDriveTier, async (req, res) => {
  try {
    const files = await listBackups(req.user.id);
    res.json({ files });
  } catch (err) {
    if (err.code === 'not_connected') return res.status(403).json({ error: 'not_connected' });
    res.status(500).json({ error: err.message });
  }
});

// Restore from a Drive backup file
router.post('/drive/restore', requireAuth, requireDriveTier, async (req, res) => {
  try {
    const { fileId } = req.body ?? {};
    if (!fileId) return res.status(400).json({ error: 'fileId required' });

    const backup = await downloadBackup(req.user.id, fileId);
    const importEntries = Array.isArray(backup) ? backup : (backup.entries ?? []);

    let imported = 0, skipped = 0;
    for (const e of importEntries) {
      const dateStr = String(e.date).slice(0, 10);
      const m = e.morning || {};
      const ev = e.evening || {};
      try {
        const r = await pool.query(
          `INSERT INTO entries
             (user_id, date,
              m_sys_l, m_dia_l, m_sys_r, m_dia_r, m_pulse, m_pulse_l, m_pulse_r,
              e_sys_l, e_dia_l, e_sys_r, e_dia_r, e_pulse, e_pulse_l, e_pulse_r,
              weight, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           ON CONFLICT (user_id, date) DO NOTHING`,
          [req.user.id, dateStr,
           m.sys_l ?? null, m.dia_l ?? null, m.sys_r ?? null, m.dia_r ?? null,
           m.pulse ?? null, m.pulse_l ?? null, m.pulse_r ?? null,
           ev.sys_l ?? null, ev.dia_l ?? null, ev.sys_r ?? null, ev.dia_r ?? null,
           ev.pulse ?? null, ev.pulse_l ?? null, ev.pulse_r ?? null,
           e.weight ?? null, e.notes ?? null]
        );
        if (r.rowCount) imported++; else skipped++;
      } catch { skipped++; }
    }

    res.json({ ok: true, imported, skipped });
  } catch (err) {
    if (err.code === 'not_connected') return res.status(403).json({ error: 'not_connected' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
