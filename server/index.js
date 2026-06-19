require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const passport = require('passport');
const path = require('path');

const { initDb } = require('./db');
const authRouter = require('./routes/auth');
const entriesRouter = require('./routes/entries');
const usersRouter = require('./routes/users');
const pdfRouter = require('./routes/pdf');
const pushRouter = require('./routes/push');
const { scheduleReminders } = require('./services/push');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());
app.use(passport.initialize());

// ── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/entries', entriesRouter);
app.use('/api/users', usersRouter);
app.use('/api/pdf', pdfRouter);
app.use('/api/push', pushRouter);

// ── Static Files ────────────────────────────────────────────────────────────
const clientDir = path.join(__dirname, '..', 'client');
app.use(express.static(clientDir));

// SPA fallback — serve index.html for any non-API route
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDir, 'index.html'));
  }
});

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
