const express = require('express');
const { pool } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getTierConfig } = require('../config/tiers');
const { uploadBackup, listBackups, downloadBackup, deleteFile } = require('../services/drive');
const { buildBackup, restoreBackup } = require('../utils/backupData');

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

// Create backup (entries + profile + labs)
router.post('/drive', requireAuth, requireDriveTier, async (req, res) => {
  try {
    const backup = await buildBackup(req.user.id);
    const result = await uploadBackup(req.user.id, backup);
    res.json({ ok: true, ...result, count: backup.entries.length });
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
    const result = await restoreBackup(req.user.id, backup);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.code === 'not_connected') return res.status(403).json({ error: 'not_connected' });
    res.status(500).json({ error: err.message });
  }
});

// Delete a backup file from Drive
router.delete('/drive/file/:fileId', requireAuth, requireDriveTier, async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId) return res.status(400).json({ error: 'fileId required' });
    await deleteFile(req.user.id, fileId);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'not_connected') return res.status(403).json({ error: 'not_connected' });
    console.error('Drive delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
