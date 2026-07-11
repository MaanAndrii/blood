// Shared backup/restore logic for JSON export/import and Google Drive backup.
// A full backup now contains: profile (health/risk fields), entries, and lab
// results. Older backups (version 2, entries-only) still restore fine — profile
// and labs are optional.

const { pool } = require('../db');
const { validateEntry } = require('./validateEntry');

const ENTRY_COLS = `date,
  m_sys_l, m_dia_l, m_sys_r, m_dia_r, m_pulse, m_pulse_l, m_pulse_r,
  e_sys_l, e_dia_l, e_sys_r, e_dia_r, e_pulse, e_pulse_l, e_pulse_r,
  weight, notes`;

const numOrNull = v => (v !== null && v !== undefined && v !== '' ? Number(v) : null);

function rowToEntry(r) {
  return {
    date:    String(r.date).slice(0, 10),
    morning: { sys_l: r.m_sys_l, dia_l: r.m_dia_l, sys_r: r.m_sys_r, dia_r: r.m_dia_r,
               pulse: r.m_pulse, pulse_l: r.m_pulse_l, pulse_r: r.m_pulse_r },
    evening: { sys_l: r.e_sys_l, dia_l: r.e_dia_l, sys_r: r.e_sys_r, dia_r: r.e_dia_r,
               pulse: r.e_pulse, pulse_l: r.e_pulse_l, pulse_r: r.e_pulse_r },
    weight:  r.weight !== null ? parseFloat(r.weight) : null,
    notes:   r.notes || null,
  };
}

// ── Build a full backup object for a user ────────────────────────────────────
async function buildBackup(userId) {
  const [entriesRes, userRes, labsRes] = await Promise.all([
    pool.query(`SELECT ${ENTRY_COLS} FROM entries WHERE user_id=$1 ORDER BY date DESC`, [userId]),
    pool.query(`SELECT name, date_of_birth, height_cm, sex, smoker, diabetic, on_bp_meds
                FROM users WHERE id=$1`, [userId]),
    pool.query(`SELECT date, hba1c, total_chol, hdl, ldl, triglycerides
                FROM lab_results WHERE user_id=$1 ORDER BY date DESC`, [userId]),
  ]);

  const u = userRes.rows[0] || {};
  const profile = {
    name:          u.name ?? null,
    date_of_birth: u.date_of_birth ? String(u.date_of_birth).slice(0, 10) : null,
    height_cm:     u.height_cm ?? null,
    sex:           u.sex ?? null,
    smoker:        u.smoker ?? null,
    diabetic:      u.diabetic ?? null,
    on_bp_meds:    u.on_bp_meds ?? null,
  };

  const labs = labsRes.rows.map(r => ({
    date:          String(r.date).slice(0, 10),
    hba1c:         numOrNull(r.hba1c),
    total_chol:    numOrNull(r.total_chol),
    hdl:           numOrNull(r.hdl),
    ldl:           numOrNull(r.ldl),
    triglycerides: numOrNull(r.triglycerides),
  }));

  return {
    version:  3,
    exported: new Date().toISOString(),
    profile,
    entries:  entriesRes.rows.map(rowToEntry),
    labs,
  };
}

// ── Restore a backup object into a user's account ────────────────────────────
// Non-clobbering for entries/labs (ON CONFLICT DO NOTHING); profile fields are
// filled from the backup only where a value is present (COALESCE keeps current).
async function restoreBackup(userId, data) {
  const importEntries = Array.isArray(data) ? data : (data?.entries ?? []);

  let imported = 0, skipped = 0;
  if (Array.isArray(importEntries)) {
    for (const e of importEntries) {
      const dateStr = String(e?.date ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { skipped++; continue; }
      const m = e.morning || {}, ev = e.evening || {};
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
          [userId, dateStr,
           m.sys_l ?? null, m.dia_l ?? null, m.sys_r ?? null, m.dia_r ?? null,
           m.pulse ?? null, m.pulse_l ?? null, m.pulse_r ?? null,
           ev.sys_l ?? null, ev.dia_l ?? null, ev.sys_r ?? null, ev.dia_r ?? null,
           ev.pulse ?? null, ev.pulse_l ?? null, ev.pulse_r ?? null,
           e.weight ?? null, e.notes ?? null]
        );
        if (r.rowCount) imported++; else skipped++;
      } catch { skipped++; }
    }
  }

  // ── Profile ────────────────────────────────────────────────────────────────
  let profileRestored = false;
  const p = (data && !Array.isArray(data) && typeof data.profile === 'object') ? data.profile : null;
  if (p) {
    const sets = [], vals = []; let idx = 1;
    const add = (col, val) => { sets.push(`${col} = COALESCE($${idx++}, ${col})`); vals.push(val); };

    if (typeof p.name === 'string' && p.name.trim()) add('name', p.name.trim().slice(0, 100));
    if (typeof p.date_of_birth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date_of_birth)) add('date_of_birth', p.date_of_birth);
    if (p.height_cm != null) { const h = parseInt(p.height_cm, 10); if (!isNaN(h) && h >= 50 && h <= 250) add('height_cm', h); }
    if (p.sex === 'male' || p.sex === 'female') add('sex', p.sex);
    if (typeof p.smoker === 'boolean')     add('smoker', p.smoker);
    if (typeof p.diabetic === 'boolean')   add('diabetic', p.diabetic);
    if (typeof p.on_bp_meds === 'boolean') add('on_bp_meds', p.on_bp_meds);

    if (sets.length) {
      vals.push(userId);
      try {
        await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${idx}`, vals);
        profileRestored = true;
      } catch { /* leave profileRestored false */ }
    }
  }

  // ── Lab results ──────────────────────────────────────────────────────────────
  const LAB_RANGES = { hba1c: [3, 20], total_chol: [1, 20], hdl: [0.3, 5], ldl: [0.3, 15], triglycerides: [0.2, 30] };
  const importLabs = (data && !Array.isArray(data) && Array.isArray(data.labs)) ? data.labs : [];
  let labsImported = 0, labsSkipped = 0;
  for (const l of importLabs) {
    const dateStr = String(l?.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) { labsSkipped++; continue; }
    const f = {};
    let ok = true, hasValue = false;
    for (const [key, [lo, hi]] of Object.entries(LAB_RANGES)) {
      const raw = l[key];
      if (raw == null || raw === '') { f[key] = null; continue; }
      const n = Number(raw);
      if (isNaN(n) || n < lo || n > hi) { ok = false; break; }
      f[key] = n; hasValue = true;
    }
    if (!ok || !hasValue) { labsSkipped++; continue; }
    try {
      const r = await pool.query(
        `INSERT INTO lab_results (user_id, date, hba1c, total_chol, hdl, ldl, triglycerides)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id, date) DO NOTHING`,
        [userId, dateStr, f.hba1c, f.total_chol, f.hdl, f.ldl, f.triglycerides]
      );
      if (r.rowCount) labsImported++; else labsSkipped++;
    } catch { labsSkipped++; }
  }

  return { imported, skipped, profileRestored, labsImported, labsSkipped };
}

// ── FULL-SYSTEM backup/restore (admin) ───────────────────────────────────────
// Dumps/restores ALL users and their data — for migrating the whole deployment
// to another server. Contains password hashes and OAuth tokens, so the endpoints
// are admin-only. Column allow-lists (never arbitrary keys from the file) guard
// against injection via a crafted backup.
const SYS_USER_COLS = [
  'email', 'name', 'avatar_url', 'google_id', 'refresh_token', 'is_admin',
  'subscription_tier', 'date_of_birth', 'reminder_morning', 'reminder_evening',
  'reminders_enabled', 'push_subscription', 'created_at', 'password_hash',
  'height_cm', 'consented_at', 'subscription_expires_at', 'timezone',
  'drive_access_token', 'drive_refresh_token', 'drive_token_expires_at',
  'sex', 'smoker', 'diabetic', 'on_bp_meds',
  'total_cholesterol', 'hdl_cholesterol', 'cholesterol_updated_at',
];
const SYS_ENTRY_COLS = [
  'date', 'm_sys_l', 'm_dia_l', 'm_sys_r', 'm_dia_r', 'm_pulse',
  'e_sys_l', 'e_dia_l', 'e_sys_r', 'e_dia_r', 'e_pulse',
  'weight', 'notes', 'm_pulse_l', 'm_pulse_r', 'e_pulse_l', 'e_pulse_r',
  'created_at', 'updated_at',
];
const SYS_LAB_COLS = ['date', 'hba1c', 'total_chol', 'hdl', 'ldl', 'triglycerides', 'created_at', 'updated_at'];

async function buildSystemBackup() {
  const [users, entries, labs] = await Promise.all([
    pool.query('SELECT * FROM users ORDER BY id'),
    pool.query('SELECT * FROM entries ORDER BY id'),
    pool.query('SELECT * FROM lab_results ORDER BY id'),
  ]);
  return {
    version:  'system-1',
    exported: new Date().toISOString(),
    counts:   { users: users.rowCount, entries: entries.rowCount, labs: labs.rowCount },
    users:    users.rows,
    entries:  entries.rows,
    labs:     labs.rows,
  };
}

async function restoreSystemBackup(data) {
  const users     = Array.isArray(data?.users)   ? data.users   : [];
  const entriesArr = Array.isArray(data?.entries) ? data.entries : [];
  const labsArr    = Array.isArray(data?.labs)    ? data.labs    : [];

  // Restore users by email (non-clobbering), mapping old id → target id.
  const idMap = new Map();
  let usersImported = 0, usersExisting = 0;
  for (const u of users) {
    if (!u || !u.email) continue;
    const cols = SYS_USER_COLS.filter(c => u[c] !== undefined);
    if (!cols.includes('email')) cols.unshift('email');
    const vals = cols.map(c => u[c] ?? null);
    const ph   = cols.map((_, i) => '$' + (i + 1));
    const sql  = `INSERT INTO users (${cols.join(', ')}) VALUES (${ph.join(', ')})
                  ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
                  RETURNING id, (xmax = 0) AS inserted`;
    try {
      const r = await pool.query(sql, vals);
      if (u.id != null) idMap.set(u.id, r.rows[0].id);
      if (r.rows[0].inserted) usersImported++; else usersExisting++;
    } catch { /* skip malformed user row */ }
  }

  const insertRows = async (arr, table, cols) => {
    let imported = 0, skipped = 0;
    for (const row of arr) {
      const tgt = idMap.get(row.user_id);
      if (!tgt) { skipped++; continue; }            // user wasn't restored → skip
      const use = cols.filter(c => row[c] !== undefined);
      const allCols = ['user_id', ...use];
      const vals = [tgt, ...use.map(c => row[c] ?? null)];
      const ph   = allCols.map((_, i) => '$' + (i + 1));
      const sql  = `INSERT INTO ${table} (${allCols.join(', ')}) VALUES (${ph.join(', ')})
                    ON CONFLICT (user_id, date) DO NOTHING`;
      try { const r = await pool.query(sql, vals); if (r.rowCount) imported++; else skipped++; }
      catch { skipped++; }
    }
    return { imported, skipped };
  };

  const e = await insertRows(entriesArr, 'entries', SYS_ENTRY_COLS);
  const l = await insertRows(labsArr, 'lab_results', SYS_LAB_COLS);

  return {
    usersImported, usersExisting,
    entriesImported: e.imported, entriesSkipped: e.skipped,
    labsImported: l.imported, labsSkipped: l.skipped,
  };
}

module.exports = { buildBackup, restoreBackup, buildSystemBackup, restoreSystemBackup };
