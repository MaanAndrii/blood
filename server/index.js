require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const { initDb, pool } = require('./db');
const authRouter = require('./routes/auth');
const entriesRouter = require('./routes/entries');
const usersRouter = require('./routes/users');
const pdfRouter = require('./routes/pdf');
const pushRouter = require('./routes/push');
const backupRouter = require('./routes/backup');
const exportRouter = require('./routes/export');
const { scheduleReminders } = require('./services/push');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust Cloudflare proxy so rate-limiting uses the real client IP
app.set('trust proxy', 1);

// ── Rate Limiting ────────────────────────────────────────────────────────────
const generalLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
const authLimit    = rateLimit({ windowMs: 15 * 60 * 1000, max: 50,  standardHeaders: true, legacyHeaders: false });

// ── Logger (V) ───────────────────────────────────────────────────────────────
const LOG_FILE = path.join(__dirname, '..', 'logs', 'app.log');
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
function logLine(level, msg) {
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  process.stdout.write(line);
  fs.appendFile(LOG_FILE, line, () => {});
}
// Patch console.error to also write to file
const _origError = console.error.bind(console);
console.error = (...args) => { _origError(...args); fs.appendFile(LOG_FILE, `${new Date().toISOString()} [ERROR] ${args.join(' ')}\n`, () => {}); };

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '500kb' }));
app.use(cookieParser());
app.use(passport.initialize());
app.use('/api/', generalLimit);
app.use('/api/auth', authLimit);

// Simple request logger
app.use((req, res, next) => {
  res.on('finish', () => {
    if (req.path.startsWith('/api')) logLine('HTTP', `${req.method} ${req.path} ${res.statusCode}`);
  });
  next();
});

// CSRF: verify Origin/Referer on all state-changing API requests.
// Google OAuth callbacks are GET and don't carry a cookie body — exempt.
app.use('/api/', (req, res, next) => {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  const origin = req.headers['origin'] || req.headers['referer'];
  if (!origin) return next(); // server-to-server / curl — no browser cookie anyway
  const appOrigin = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
  try {
    if (new URL(origin).origin !== new URL(appOrigin).origin) {
      return res.status(403).json({ error: 'Invalid origin' });
    }
  } catch {
    return res.status(403).json({ error: 'Invalid origin' });
  }
  next();
});

// ── Health check (no auth required — used by monitoring/Cloudflare) ─────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, ts: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  } catch (err) {
    res.status(503).json({ ok: false, ts: new Date().toISOString(), error: 'DB unavailable' });
  }
});

// ── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/entries', entriesRouter);
app.use('/api/users', usersRouter);
app.use('/api/pdf', pdfRouter);
app.use('/api/push', pushRouter);
app.use('/api/backup', backupRouter);
app.use('/api/export', exportRouter);

// ── Static Files ────────────────────────────────────────────────────────────
const clientDir = path.join(__dirname, '..', 'client');
app.use(express.static(clientDir, { extensions: ['html'], index: false }));

// Root: landing for guests, SPA for authenticated users
// Must never be cached — response depends on auth cookie
const jwt = require('jsonwebtoken');
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const token = req.cookies?.token;
  if (token) {
    try {
      jwt.verify(token, process.env.JWT_SECRET);
      return res.sendFile(path.join(clientDir, 'index.html'));
    } catch {}
  }
  res.sendFile(path.join(clientDir, 'landing.html'));
});

// SPA fallback — serve index.html for any non-API route
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDir, 'index.html'));
  }
});

// ── Startup Validation ───────────────────────────────────────────────────────
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length) {
  console.error(`[server] Missing required env vars: ${missingEnv.join(', ')}`);
  process.exit(1);
}

// ── Start ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await initDb();
    console.log('[db] Database initialized');

    scheduleReminders();

    app.listen(PORT, () => {
      console.log(`[server] Listening on port ${PORT}`);
      console.log(`[server] NODE_ENV=${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('[server] Failed to start:', err);
    process.exit(1);
  }
}

start();
