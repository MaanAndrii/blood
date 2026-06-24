const { pool } = require('../db');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = 'BP & BMI Backup';

function driveAuthUrl(userId) {
  const state = Buffer.from(String(userId)).toString('base64');
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  process.env.GOOGLE_DRIVE_CALLBACK_URL,
    response_type: 'code',
    scope:         'https://www.googleapis.com/auth/drive.file',
    access_type:   'offline',
    prompt:        'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchangeCode(code) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  process.env.GOOGLE_DRIVE_CALLBACK_URL,
      grant_type:    'authorization_code',
    }),
  });
  return r.json();
}

async function refreshToken(refreshTok) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshTok,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token',
    }),
  });
  return r.json();
}

async function getAccessToken(userId) {
  const { rows } = await pool.query(
    'SELECT drive_access_token, drive_refresh_token, drive_token_expires_at FROM users WHERE id=$1',
    [userId]
  );
  const row = rows[0];
  if (!row?.drive_refresh_token) {
    const err = new Error('Drive not connected');
    err.code = 'not_connected';
    throw err;
  }

  const expiresAt = row.drive_token_expires_at ? new Date(row.drive_token_expires_at) : null;
  const stale = !expiresAt || expiresAt < new Date(Date.now() + 60_000);

  if (!stale && row.drive_access_token) return row.drive_access_token;

  const tokens = await refreshToken(row.drive_refresh_token);
  if (!tokens.access_token) throw new Error('Token refresh failed');

  await pool.query(
    'UPDATE users SET drive_access_token=$1, drive_token_expires_at=$2 WHERE id=$3',
    [tokens.access_token, new Date(Date.now() + tokens.expires_in * 1000), userId]
  );
  return tokens.access_token;
}

async function driveGet(userId, path) {
  const token = await getAccessToken(userId);
  const r = await fetch(`${DRIVE_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error?.message || `Drive ${r.status}`); }
  return r.json();
}

async function ensureFolder(userId) {
  const q = `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const data = await driveGet(userId, `/files?q=${encodeURIComponent(q)}&fields=files(id)`);
  if (data.files?.length) return data.files[0].id;

  const token = await getAccessToken(userId);
  const r = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const folder = await r.json();
  return folder.id;
}

function buildMultipart(boundary, meta, body) {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(meta),
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    body,
    `--${boundary}--`,
  ].join('\r\n');
}

async function uploadBackup(userId, payload) {
  const folderId = await ensureFolder(userId);
  const today = new Date().toISOString().slice(0, 10);
  const filename = `health_backup_${today}.json`;
  const content = JSON.stringify(payload, null, 2);

  // Check for existing file with same name today (update it instead of creating duplicate)
  const q = `name='${filename}' and '${folderId}' in parents and trashed=false`;
  const existing = await driveGet(userId, `/files?q=${encodeURIComponent(q)}&fields=files(id)`);

  const token = await getAccessToken(userId);
  const boundary = 'bp_bmi_' + Date.now();

  if (existing.files?.length) {
    const fileId = existing.files[0].id;
    const mp = buildMultipart(boundary, { name: filename }, content);
    await fetch(`${DRIVE_UPLOAD}/files/${fileId}?uploadType=multipart`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: mp,
    });
  } else {
    const mp = buildMultipart(boundary, { name: filename, parents: [folderId] }, content);
    await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: mp,
    });
  }

  return { filename, date: today };
}

async function listBackups(userId) {
  const folderId = await ensureFolder(userId);
  const q = `'${folderId}' in parents and trashed=false`;
  const data = await driveGet(
    userId,
    `/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime+desc&pageSize=20`
  );
  return data.files || [];
}

async function downloadBackup(userId, fileId) {
  const token = await getAccessToken(userId);
  const r = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error('Download failed');
  return r.json();
}

module.exports = { driveAuthUrl, exchangeCode, uploadBackup, listBackups, downloadBackup };
