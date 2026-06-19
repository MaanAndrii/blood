const { Pool, types } = require('pg');

// Return DATE columns as plain strings (e.g. '2026-06-19') instead of
// Date objects. Without this, pg creates Date at local midnight which
// toISOString() shifts back a day in UTC+N timezones (e.g. UTC+3 → June 18).
types.setTypeParser(1082, val => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar_url TEXT,
      google_id TEXT UNIQUE,
      refresh_token TEXT,
      is_admin BOOLEAN DEFAULT FALSE,
      subscription_tier TEXT DEFAULT 'free',
      date_of_birth DATE,
      reminder_morning TIME DEFAULT '08:00',
      reminder_evening TIME DEFAULT '20:00',
      reminders_enabled BOOLEAN DEFAULT FALSE,
      push_subscription JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      m_sys_l SMALLINT, m_dia_l SMALLINT,
      m_sys_r SMALLINT, m_dia_r SMALLINT,
      m_pulse SMALLINT,
      e_sys_l SMALLINT, e_dia_l SMALLINT,
      e_sys_r SMALLINT, e_dia_r SMALLINT,
      e_pulse SMALLINT,
      weight NUMERIC(5,1),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, date)
    )
  `);
}

module.exports = { pool, initDb };
