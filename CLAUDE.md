# Blood Health Monitor — Project Context

## Versioning rule

**При кожній зміні коду** збільшувати версію програми на +0.01:
- `client/index.html` → `const APP_VERSION = 'X.XX'`
- `client/sw.js` → `const CACHE = 'health-vN'` і `const API_CACHE = 'health-api-vN'` (N — ціле, збільшувати на 1)

Поточна версія: **1.07** (SW: health-v7).

## Stack

- **Backend**: Node.js 20 + Express, PostgreSQL (`pg`), bcryptjs, JWT (httpOnly cookie, 30d)
- **Auth**: Google OAuth 2.0 (Passport.js) + local email/password (bcrypt 10 rounds)
- **Push**: Web Push API + VAPID + node-cron (server-side scheduled reminders)
- **Frontend**: Vanilla JS SPA, Chart.js (CDN), CSS scroll-snap drum rollers (iOS-style)
- **PDF**: Puppeteer + system Chromium (`/usr/bin/chromium`)
- **Deploy**: Raspberry Pi 5, systemd, Cloudflare Tunnel

## File structure

```
server/
  index.js              — Express app, middleware, route mounting, /api/health
  db.js                 — pg pool, initDb() migrations (ALTER TABLE IF NOT EXISTS)
  middleware/auth.js    — requireAuth / requireAdmin (JWT cookie)
  config/tiers.js       — getEffectiveTier(), getTierConfig()
  routes/
    auth.js             — Google OAuth, Google Drive OAuth, local register/login, /me
    entries.js          — GET/POST/DELETE /api/entries
    users.js            — PUT/DELETE /api/users/me, admin CRUD
    pdf.js              — POST /api/pdf (Puppeteer)
    push.js             — VAPID key, push subscription
    backup.js           — Drive backup/restore (status, create, list, restore, disconnect)
  services/
    drive.js            — Google Drive API (token refresh, folder, upload, list, download)
client/
  index.html            — entire SPA (HTML + CSS + JS inline)
  sw.js                 — Service Worker (offline mode: app shell + API GET cache)
logs/app.log            — file-based error log
```

## Key conventions

- `pg.types.setTypeParser(1082, val => val)` — DATE columns return plain strings, not Date objects
- `entries` table columns: `m_sys_l`, `m_dia_l`, `m_sys_r`, `m_dia_r`, `m_pulse`, `m_pulse_l`, `m_pulse_r` (and `e_` equivalents)
- `subscription_tier`: `'premium'` | `'demo'` (all new users get `'premium'`; legacy `'free'` migrated → `'premium'` on startup)
- `rollerFormData` object holds all roller values; `_loadPending` counter prevents race condition between programmatic scroll (rAF) and `_saveRollerToFormData`
- `selectedWeekDate`: `null` = show today on home; otherwise shows selected past date
- `openEntryModal(date, allowEdit)`: editing only via Journal tab; `openSmartEntryModal()` opens modal first then fills data via double-rAF
- `todayStr()` / `_localDateStr(d)` — always use local year/month/day (never `toISOString()` for date strings — it returns UTC which breaks around midnight in UTC+N)
- Google Drive tokens stored per-user: `drive_access_token`, `drive_refresh_token`, `drive_token_expires_at`; auto-refreshed before each request in `server/services/drive.js`

## Active branch

`claude/dreamy-cannon-p1768u`

---

## Feature checklist

### ✅ Implemented

- [x] Blood pressure + pulse (per hand) + weight entry via drum-roller modal
- [x] Per-hand pulse stored separately (`m_pulse_l`, `m_pulse_r`); averaged in `m_pulse` for PDF
- [x] Home page: 7-day week strip, single-day summary card, systolic trend chart
- [x] Smart FAB: detects missing period (morning/evening) and pre-selects it
- [x] Editing restricted to Journal tab only (week strip clicks = view only)
- [x] Race condition fix: `_loadPending` counter prevents `_saveRollerToFormData` reading stale DOM
- [x] Entry modal opens first, data fills via double-rAF (fixes fake data on period switch)
- [x] Date picker hidden in edit modal; date shown in title instead
- [x] Push notification settings persist across reloads (synced from server on `initApp`)
- [x] Google OAuth 2.0 login
- [x] **Local email/password registration + login** (bcryptjs, 10 rounds)
- [x] **Two user tiers: Demo / Premium** (all new users = Premium; tier badge in user chip)
- [x] PDF report (Puppeteer)
- [x] CSV + JSON export / import (CSV includes `notes` column; JSON capped at 5 MB)
- [x] Web Push reminders (VAPID, node-cron)
- [x] User profile (name, date of birth, height)
- [x] **WHO/ESH 2023 BP classification** (8 categories: Optimal → Grade 3 + Isolated Systolic/Diastolic)
- [x] **BMI calculation** (`calcBmi`/`bmiCategory`): shown in summary card + profile modal preview; stored as `height_cm` in users table
- [x] **GDPR compliance**: consent at registration (`consented_at`), Privacy Policy modal, delete account (`DELETE /api/users/me`)
- [x] XSS-safe rendering (`escHtml`)
- [x] File-based error logging (`logs/app.log`)
- [x] `/api/health` checks DB connectivity (`SELECT 1`)
- [x] **Journal tab**: cards are clickable, open fixed-height day detail modal; edit/delete inside modal only
- [x] **Day detail modal**: swipe left/right + nav buttons to browse days; all rows always rendered (shows `—` when no data)
- [x] **First-login onboarding**: profile modal auto-opens if DOB and height are not set
- [x] **Midnight/timezone fix**: `_localDateStr()` used everywhere for date strings (fixes week strip showing wrong day after midnight in UTC+N)
- [x] **Google Drive backup + restore**: separate OAuth (`drive.file` scope), token stored in DB, folder «BP & BMI Backup», per-day files, no-overwrite restore

### 🔲 Pending / Known issues

- [ ] **D** — Timezone selector for reminders (cron runs in server TZ; Pi uses `timedatectl`)
- [x] **J** — Demo tier server-side enforcement: `tierGuard` middleware on all export/import endpoints; `requireDriveTier` on Drive backup/restore; 403 `demo_restricted` returned for blocked features
- [x] **M** — Service Worker offline mode: app shell + icons cached on install (`health-v4`); `/api/entries` + `/api/auth/me` network-first with stale cache fallback; mutations network-only

### 🔲 Future / Deferred

- [ ] Admin panel rework (add/remove users, change tier)
- [ ] Automatic scheduled Drive backup (node-cron daily)
- [ ] Timezone selector in Settings tab
