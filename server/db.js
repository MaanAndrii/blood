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

  // Add per-hand pulse columns if they don't exist yet (migration for existing DBs)
  await pool.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS m_pulse_l SMALLINT`);
  await pool.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS m_pulse_r SMALLINT`);
  await pool.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS e_pulse_l SMALLINT`);
  await pool.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS e_pulse_r SMALLINT`);

  // Add password_hash column for local auth
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  // Add height for BMI calculation
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS height_cm SMALLINT`);
  // GDPR: explicit consent timestamp
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS consented_at TIMESTAMPTZ`);
  // Subscription expiry for premium periods
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ`);
  // Migrate legacy 'free' tier to 'premium'
  await pool.query(`UPDATE users SET subscription_tier = 'premium' WHERE subscription_tier = 'free' OR subscription_tier IS NULL`);
  // Migrate is_admin=TRUE users to admin tier
  await pool.query(`UPDATE users SET subscription_tier = 'admin', subscription_expires_at = NULL WHERE is_admin = TRUE AND subscription_tier != 'admin'`);
  // Migrate short-expiry trial premiums (created within 8 days of expiry) → demo
  await pool.query(`UPDATE users SET subscription_tier = 'demo', subscription_expires_at = NULL WHERE subscription_tier = 'premium' AND subscription_expires_at IS NOT NULL AND (subscription_expires_at - created_at) <= interval '8 days'`);
  // User timezone for reminder scheduling
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Europe/Kyiv'`);

  // Cardiovascular risk profile fields (Framingham non-lab + SCORE2/OP)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sex TEXT`);              // 'male' | 'female'
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS smoker BOOLEAN`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS diabetic BOOLEAN`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS on_bp_meds BOOLEAN`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_cholesterol NUMERIC(4,2)`); // mmol/L
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hdl_cholesterol NUMERIC(4,2)`);   // mmol/L
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cholesterol_updated_at TIMESTAMPTZ`);
  // Google Drive backup tokens
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS drive_access_token TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS drive_refresh_token TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS drive_token_expires_at TIMESTAMPTZ`);

  // Lab results — dated blood-work panels (lipids + HbA1c). One row per day.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lab_results (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      hba1c NUMERIC(4,2),           -- glycated hemoglobin, %
      total_chol NUMERIC(4,2),      -- total cholesterol, mmol/L
      hdl NUMERIC(4,2),             -- HDL cholesterol, mmol/L
      ldl NUMERIC(4,2),             -- LDL cholesterol, mmol/L
      triglycerides NUMERIC(4,2),   -- mmol/L
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, date)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_lab_results_user_date ON lab_results(user_id, date DESC)
  `);
  // One-time seed: migrate legacy per-user cholesterol snapshot into a dated lab row
  await pool.query(`
    INSERT INTO lab_results (user_id, date, total_chol, hdl)
    SELECT u.id, COALESCE(u.cholesterol_updated_at::date, CURRENT_DATE),
           u.total_cholesterol, u.hdl_cholesterol
    FROM users u
    WHERE (u.total_cholesterol IS NOT NULL OR u.hdl_cholesterol IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM lab_results lr WHERE lr.user_id = u.id)
  `);

  // Password reset tokens (email-based flow)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_entries_user_date
    ON entries(user_id, date DESC)
  `);
}

module.exports = { pool, initDb };
