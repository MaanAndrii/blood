# Blood Health Monitor — Project Context

## Stack

- **Backend**: Node.js 20 + Express, PostgreSQL (`pg`), bcryptjs, JWT (httpOnly cookie, 30d)
- **Auth**: Google OAuth 2.0 (Passport.js) + local email/password (bcrypt 10 rounds)
- **Push**: Web Push API + VAPID + node-cron (server-side scheduled reminders)
- **Frontend**: Vanilla JS SPA, Chart.js (CDN), CSS scroll-snap drum rollers (iOS-style)
- **PDF**: Puppeteer + system Chromium (`/usr/bin/chromium`)
- **Deploy**: Raspberry Pi 5, systemd, Cloudflare Tunnel

## Key conventions

- `pg.types.setTypeParser(1082, val => val)` — DATE columns return plain strings (not Date objects)
- `entries` table uses `m_`/`e_` prefix for morning/evening: `m_sys_l`, `m_dia_l`, `m_sys_r`, `m_dia_r`, `m_pulse`, `m_pulse_l`, `m_pulse_r` (and `e_` equivalents)
- `subscription_tier`: `'premium'` | `'demo'` (all new users get `'premium'`; legacy `'free'` migrated → `'premium'` on startup)
- `rollerFormData` object holds all roller values; `_loadPending` counter prevents race condition between programmatic scroll (rAF) and `_saveRollerToFormData`
- `selectedWeekDate`: `null` = show today on home; otherwise shows selected past date
- `openEntryModal(date, allowEdit)`: editing only via Journal; `openSmartEntryModal()` opens modal first then fills data via double-rAF

## Active branch

`claude/dreamy-cannon-p1768u`

---

## Feature checklist

### ✅ Implemented

- [x] Blood pressure + pulse (per hand) + weight entry via drum-roller modal
- [x] Per-hand pulse stored separately (`m_pulse_l`, `m_pulse_r`); averaged in `m_pulse` for PDF/display
- [x] Home page: 7-day week strip, single-day summary card, systolic trend chart
- [x] Smart FAB: detects missing period (morning/evening) and pre-selects it
- [x] Editing restricted to Journal tab only (week strip clicks = view only)
- [x] Race condition fix: `_loadPending` counter prevents `_saveRollerToFormData` reading stale DOM
- [x] Entry modal opens first, data fills via double-rAF (fixes fake data on period switch)
- [x] Date picker hidden in edit modal; date shown in title instead
- [x] Push notification settings persist across reloads (synced from server on `initApp`)
- [x] Google Drive backup button (disabled placeholder)
- [x] Google OAuth 2.0 login
- [x] **Local email/password registration + login** (bcryptjs, 10 rounds)
- [x] **Two user tiers: Demo / Premium** (all new users = Premium; tier badge in user chip)
- [x] PDF report (Puppeteer)
- [x] CSV + JSON export / import
- [x] Web Push reminders (VAPID, node-cron)
- [x] User profile (name, date of birth, height)
- [x] **WHO/ESH 2018 BP classification** (8 categories: Optimal→Grade 3 + Isolated Systolic/Diastolic)
- [x] **BMI calculation** (`calcBmi`/`bmiCategory`): shown in summary card + profile modal preview; stored as `height_cm` in users table
- [x] XSS-safe rendering (`escHtml`)
- [x] File-based error logging (`logs/app.log`)

### 🔲 Pending / Known issues

- [ ] **D** — Timezone for reminders (`timedatectl` on Pi, cron runs in server TZ)
- [ ] **G** — CSV export missing `notes` column
- [ ] **H** — `/api/health` doesn't check DB connection (always returns `{ok:true}`)
- [ ] **J** — `subscription_tier` column exists but Demo restrictions not implemented (future)
- [ ] **K** — `refresh_token` stored but unused
- [ ] **L** — JSON import has no file size limit (DoS risk)
- [ ] **M** — Service Worker caches only root + manifest (offline mode incomplete)
- [ ] **X** — Google Drive backup (button is placeholder, no functionality yet)

### 🔲 Future / Deferred

- [ ] Admin panel rework (add/remove users, change tier)
- [ ] Google Drive real backup implementation
- [ ] Demo tier feature restrictions
- [ ] Timezone selector in settings
