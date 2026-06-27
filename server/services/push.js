const webpush = require('web-push');
const cron = require('node-cron');
const { pool } = require('../db');

function initWebPush() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[push] VAPID keys not set — push notifications disabled');
    return false;
  }
  webpush.setVapidDetails(
    VAPID_EMAIL || 'mailto:admin@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  return true;
}

async function sendPush(subscription, title, body, data = {}) {
  if (!subscription) return;
  const endpoint = subscription.endpoint?.slice(-30) || '?';
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({ title, body, data })
    );
    console.log(`[push] sent OK ...${endpoint}`);
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      console.log(`[push] subscription expired (${err.statusCode}), clearing ...${endpoint}`);
      try {
        await pool.query(
          'UPDATE users SET push_subscription = NULL WHERE push_subscription->>\'endpoint\' = $1',
          [subscription.endpoint]
        );
      } catch {}
    } else {
      console.error(`[push] sendPush error ${err.statusCode || ''}: ${err.message}`);
    }
  }
}

function scheduleReminders() {
  const vapidReady = initWebPush();
  if (!vapidReady) return;

  // Run every minute
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();

      // Fetch all users with reminders enabled
      const usersResult = await pool.query(
        `SELECT u.id, u.name, u.push_subscription, u.timezone,
                TO_CHAR(u.reminder_morning, 'HH24:MI') AS reminder_morning,
                TO_CHAR(u.reminder_evening, 'HH24:MI') AS reminder_evening
         FROM users u
         WHERE u.reminders_enabled = TRUE
           AND u.push_subscription IS NOT NULL`
      );

      for (const user of usersResult.rows) {
        if (!user.push_subscription) continue;

        // Get current time and today's date in user's timezone
        const tz = user.timezone || 'Europe/Kyiv';
        let currentTime, todayStr;
        try {
          currentTime = new Intl.DateTimeFormat('en-GB', {
            timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
          }).format(now).replace(',', '').trim();
          todayStr = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
          }).format(now);
        } catch {
          // Fallback to server time if timezone is invalid
          currentTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
          todayStr = now.toISOString().slice(0, 10);
        }

        const isMorning = user.reminder_morning === currentTime;
        const isEvening = user.reminder_evening === currentTime;
        if (!isMorning && !isEvening) continue;

        // Check if entry exists for today (in user's local timezone)
        const entryResult = await pool.query(
          'SELECT m_sys_l, m_sys_r, e_sys_l, e_sys_r FROM entries WHERE user_id = $1 AND date = $2',
          [user.id, todayStr]
        );
        const entry = entryResult.rows[0] || {};

        if (isMorning && !(entry.m_sys_l != null || entry.m_sys_r != null)) {
          console.log(`[push] morning reminder → user ${user.id} (${tz})`);
          await sendPush(user.push_subscription, '🌅 Час виміряти тиск',
            'Зробіть ранковий вимір — це займе хвилину.', { url: '/' });
        }
        if (isEvening && !(entry.e_sys_l != null || entry.e_sys_r != null)) {
          console.log(`[push] evening reminder → user ${user.id} (${tz})`);
          await sendPush(user.push_subscription, '🌙 Час виміряти тиск',
            'Зробіть вечірній вимір — це займе хвилину.', { url: '/' });
        }
      }
    } catch (err) {
      console.error('[push] scheduleReminders error:', err.message);
    }
  });

  console.log('[push] Reminder scheduler started');
}

module.exports = { sendPush, scheduleReminders, initWebPush };
