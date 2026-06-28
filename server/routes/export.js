const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getTierConfig } = require('../config/tiers');
const { validateEntry } = require('../utils/validateEntry');

const router = express.Router();

async function getUserWithTier(userId) {
  const { rows } = await pool.query(
    'SELECT subscription_tier, subscription_expires_at FROM users WHERE id=$1',
    [userId]
  );
  return rows[0];
}

function tierGuard(flag) {
  return async (req, res, next) => {
    const user = await getUserWithTier(req.user.id);
    const cfg = getTierConfig(user);
    if (!cfg[flag]) return res.status(403).json({ error: 'demo_restricted' });
    next();
  };
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

// GET /api/export/csv
router.get('/csv', requireAuth, tierGuard('export_csv'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT date,
              m_sys_l, m_dia_l, m_sys_r, m_dia_r, m_pulse, m_pulse_l, m_pulse_r,
              e_sys_l, e_dia_l, e_sys_r, e_dia_r, e_pulse, e_pulse_l, e_pulse_r,
              weight, notes
       FROM entries WHERE user_id=$1 ORDER BY date DESC`,
      [req.user.id]
    );

    const header = [
      'Дата',
      'Ранок Сист. Л','Ранок Діаст. Л','Ранок Сист. П','Ранок Діаст. П',
      'Ранок Пульс','Ранок Пульс Л','Ранок Пульс П',
      'Вечір Сист. Л','Вечір Діаст. Л','Вечір Сист. П','Вечір Діаст. П',
      'Вечір Пульс','Вечір Пульс Л','Вечір Пульс П',
      'Вага','Нотатки',
    ].join(',');

    const lines = rows.map(r => [
      String(r.date).slice(0, 10),
      r.m_sys_l ?? '', r.m_dia_l ?? '', r.m_sys_r ?? '', r.m_dia_r ?? '',
      r.m_pulse ?? '', r.m_pulse_l ?? '', r.m_pulse_r ?? '',
      r.e_sys_l ?? '', r.e_dia_l ?? '', r.e_sys_r ?? '', r.e_dia_r ?? '',
      r.e_pulse ?? '', r.e_pulse_l ?? '', r.e_pulse_r ?? '',
      r.weight ?? '', csvCell(r.notes),
    ].join(','));

    const csv = '﻿' + [header, ...lines].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="health_data.csv"');
    res.send(csv);
  } catch (err) {
    console.error('GET /api/export/csv error:', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// GET /api/export/json
router.get('/json', requireAuth, tierGuard('export_json'), async (req, res) => {
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

    const payload = JSON.stringify({ version: 2, exported: new Date().toISOString(), entries }, null, 2);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="health_backup.json"');
    res.send(payload);
  } catch (err) {
    console.error('GET /api/export/json error:', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// POST /api/export/import — bulk import from JSON file
router.post('/import', requireAuth, tierGuard('import_json'), async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid body' });

    const importEntries = Array.isArray(body) ? body : (body.entries ?? []);
    if (!Array.isArray(importEntries)) return res.status(400).json({ error: 'entries must be array' });
    if (importEntries.length > 10000) return res.status(400).json({ error: 'Too many entries (max 10000)' });

    let imported = 0, skipped = 0;
    for (const e of importEntries) {
      const dateStr = String(e.date ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { skipped++; continue; }
      const m = e.morning || {};
      const ev = e.evening || {};
      if (validateEntry(m, ev, e.weight ?? null)) { skipped++; continue; }
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
    console.error('POST /api/export/import error:', err);
    res.status(500).json({ error: 'Import failed' });
  }
});

module.exports = router;
