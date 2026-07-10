# Blood Health Monitor — Project Context

## Versioning rule

**При кожній зміні коду** збільшувати версію програми на +0.01:
- `client/js/state.js` → `const APP_VERSION = 'X.XX'`
- `client/sw.js` → `const CACHE = 'health-vN'` і `const API_CACHE = 'health-api-vN'` (N — ціле, збільшувати на 1)

Поточна версія: **3.15** (SW: health-v64).

## Stack

- **Backend**: Node.js 20 + Express, PostgreSQL (`pg`), bcryptjs, JWT (httpOnly cookie, 7d)
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
  utils/validateEntry.js — shared validation for entry payloads
  routes/
    auth.js             — Google OAuth, Google Drive OAuth, local register/login,
                           forgot/reset password, /me
    entries.js          — GET/POST/DELETE /api/entries
    users.js            — PUT/DELETE /api/users/me, admin CRUD (list/invite/update/delete)
    pdf.js              — POST /api/pdf (Puppeteer)
    push.js             — VAPID key, push subscription
    backup.js           — Drive backup/restore (status, create, list, restore, disconnect)
    export.js           — CSV/JSON export, JSON import (tier-gated via tierGuard)
    labs.js             — GET/POST/DELETE /api/labs (dated lab_results panels)
  services/
    drive.js            — Google Drive API (token refresh, folder, upload, list, download)
    pdf.js              — Puppeteer PDF report generation
    push.js             — VAPID/web-push send + node-cron reminder scheduling
    email.js            — Resend API password-reset email (no-op log if RESEND_API_KEY unset)
client/
  index.html            — SPA shell (HTML + CSS); JS split into client/js/*.js modules
  js/                    — state.js, api.js, queue.js, auth.js, ui.js, rollers.js,
                            entries.js, home.js, risk.js, labs.js, journal.js, drive.js,
                            charts.js, export.js, reminders.js, init.js (loaded in this order)
  sw.js                  — Service Worker (offline mode: app shell + API GET cache)
  landing.html           — public landing page + embedded login/register form
  admin.html             — admin panel (user list, tier changes, invite)
  reset-password.html    — password-reset form (consumes /api/auth/reset-password token)
  privacy.html / terms.html / offline.html
logs/app.log            — file-based error log
```

## Key conventions

- `pg.types.setTypeParser(1082, val => val)` — DATE columns return plain strings, not Date objects
- `entries` table columns: `m_sys_l`, `m_dia_l`, `m_sys_r`, `m_dia_r`, `m_pulse`, `m_pulse_l`, `m_pulse_r` (and `e_` equivalents)
- `subscription_tier`: `'admin'` | `'premium'` | `'demo'` | `'free'` (all new users get `'premium'`; legacy `'free'` migrated → `'premium'` on startup). `'demo'` has full access for `DEMO_DAYS` (7 days from `created_at`, see `server/config/tiers.js`) then auto-downgrades to `'free'` (restricted: `max_history_days=30`, exports/Drive backup disabled). `'free'` is otherwise a legacy value kept for the post-demo/post-expiry state, not assigned at signup.
- `rollerFormData` object holds all roller values; `rollerTouched` (a `Set` of `"period-hand"` keys) tracks which roller combinations have real data, preventing untouched rollers from being saved
- `selectedWeekDate`: `null` = show today on home; otherwise shows selected past date
- `openEntryModal(date, allowEdit)`: editing only via Journal tab, fills data via single rAF after the modal opens; `openSmartEntryModal()` opens modal first then fills data via double-rAF (fixes fake data on period switch)
- `todayStr()` / `_localDateStr(d)` (defined in `client/js/ui.js`) — always use local year/month/day (never `toISOString()` for date strings — it returns UTC which breaks around midnight in UTC+N)
- Google Drive tokens stored per-user: `drive_access_token`, `drive_refresh_token`, `drive_token_expires_at`; auto-refreshed before each request in `server/services/drive.js`
- `APP_URL` env var must be set equal to `BASE_URL` — used for the CSRF Origin check (`server/index.js`) and to build password-reset email links (`server/routes/auth.js`); if unset, both fall back to defaults that are wrong for anyone other than the original deployment
- Password reset emails go through Resend (`server/services/email.js`); without `RESEND_API_KEY` set, the reset link is only logged to `logs/app.log`, not emailed

## Active branch

Development happens on short-lived `claude/*` feature branches merged into `main` via PR — there is no single long-lived active branch to track here. Always branch from and update docs against `main`.

---

## Feature checklist

### ✅ Implemented

- [x] Blood pressure + pulse (per hand) + weight entry via drum-roller modal
- [x] Per-hand pulse stored separately (`m_pulse_l`, `m_pulse_r`); averaged in `m_pulse` for PDF
- [x] Home page: 7-day week strip, single-day summary card, systolic trend chart
- [x] Smart FAB: detects missing period (morning/evening) and pre-selects it
- [x] Editing restricted to Journal tab only (week strip clicks = view only)
- [x] Race condition fix: `rollerTouched` Set + double-rAF sequencing prevent `_saveRollerToFormData` reading stale/untouched roller DOM
- [x] Entry modal opens first, data fills via double-rAF (fixes fake data on period switch)
- [x] Date picker hidden in edit modal; date shown in title instead
- [x] Push notification settings persist across reloads (synced from server on `initApp`)
- [x] Google OAuth 2.0 login
- [x] **Local email/password registration + login** (bcryptjs, 10 rounds)
- [x] **User tiers: Admin / Premium / Demo / Free** (all new users = Premium; Demo auto-downgrades to Free after 7 days; tier badge in user chip)
- [x] PDF report (Puppeteer) — short/extended modes, both colour-coded: BP cells tinted by WHO/ESH status (good/warning/serious/critical) with ⚠/‼ icons (never colour-only), pulse ↓/↑ (brady/tachy) and per-day arm-difference ⚖️ markers, colour legend; extended adds a period-overview panel, stats/trends/correlations and the latest lab panel
- [x] CSV + JSON export / import (CSV includes `notes` column; JSON capped at 5 MB). JSON export **and Google Drive backup** are full backups (version 3): profile risk fields + entries + `lab_results`; restore is non-clobbering for entries/labs and fills profile via COALESCE. Shared logic in `server/utils/backupData.js` (`buildBackup`/`restoreBackup`); old version-2 (entries-only) backups still restore
- [x] Web Push reminders (VAPID, node-cron)
- [x] User profile (name, date of birth, height)
- [x] **WHO/ESH 2023 BP classification** (8 categories: Optimal → Grade 3 + Isolated Systolic/Diastolic)
- [x] **Cardiovascular risk estimation** (`client/js/risk.js`): 10-year CVD risk in the «Аналіз» tab (after the WHO/ESH card; rendered from `renderCharts()`) via two models — Framingham non-laboratory/BMI (D'Agostino 2008) and SCORE2/SCORE2-OP (ESC 2021, «very high risk» region for Ukraine). Profile risk fields: `sex`, `smoker`, `diabetic` (fallback), `on_bp_meds`. SBP taken from mean of home readings over last 30 days; total/HDL cholesterol come from the latest lab panel; diabetes status derived from latest HbA1c (≥6.5%) with the profile flag as fallback. Card shows disclaimer (orientation only, home-BP calibration caveat)
- [x] **Lab results** (`lab_results` table, `client/js/labs.js`): dated blood-work panels (HbA1c %, total/HDL/LDL cholesterol, triglycerides in mmol/L), one row per date, newest feeds the risk models. «Лабораторні показники» card lives in the «Аналіз» tab (rendered early in `renderCharts()` so a later chart error can't block it); the home page has only a «🧪 Додати аналіз крові» quick-add button. Card shows per-value evaluation vs ESC very-high-risk targets (LDL <1.4, non-HDL <2.2), computed non-HDL & TG/HDL, Friedewald cross-check, add/edit/delete modal + history. Latest panel also appears in the extended PDF report. Legacy `users.total_cholesterol`/`hdl_cholesterol` migrated into a seed lab row on startup
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
- [x] **Public landing page**: single `/` route — server checks JWT cookie: authenticated → SPA (`index.html`), guest → landing page (`landing.html`)
- [x] **Landing page auth form**: Google OAuth + local login/register tabs embedded on landing page; no redirect needed
- [x] **Privacy Policy + Terms of Use pages**: `client/privacy.html`, `client/terms.html`; linked from landing and SPA footer
- [x] **Modal overlay improvements**: darker background (`rgba(0,0,0,.75)` + blur), CSS `:has()` blocks pointer-events on body while modal is open
- [x] **Google OAuth → `/app` redirect**: after OAuth callback, server redirects to `/app` (not `/`) to bypass SW cache of landing page; SPA normalizes URL to `/` via `history.replaceState`
- [x] **Cloudflare trust proxy**: `app.set('trust proxy', 1)` so rate limiter uses real client IP (not Cloudflare IP)
- [x] **Dead code removed**: `avg()`, `bpStatus()`, `armDiffWarning()` JS functions; `.range-bar`, `.range-ok`, `.range-high`, `.range-low` CSS
- [x] **Frontend split into modules**: `client/index.html` is now shell-only; JS lives in `client/js/*.js` (see File structure)
- [x] **Local password reset**: `forgot-password` / `reset-password` endpoints (hashed, 1h-expiry, single-use tokens) + Resend email (`server/services/email.js`), `client/reset-password.html`
- [x] **Admin panel**: `client/admin.html` — list users with activity stats, invite by email, change tier/expiry, delete user (guards against removing the last admin)

### 🔲 Pending / Known issues

- [ ] **D** — Timezone selector for reminders (cron runs in server TZ; Pi uses `timedatectl`)
- [x] **J** — Demo tier server-side enforcement: `tierGuard` middleware on all export/import endpoints; `requireDriveTier` on Drive backup/restore; 403 `demo_restricted` returned for blocked features
- [x] **M** — Service Worker offline mode: app shell + icons cached on install (`health-v14`); `/api/entries` + `/api/auth/me` network-first with stale cache fallback; mutations network-only

### 🔲 Future / Deferred

- [ ] Automatic scheduled Drive backup (node-cron daily)
- [ ] Timezone selector in Settings tab
