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
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({ title, body, data })
    );
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired — clear it
      try {
        await pool.query(
          'UPDATE users SET push_subscription = NULL WHERE push_subscription->>\'endpoint\' = $1',
          [subscription.endpoint]
        );
      } catch {}
    } else {
      console.error('[push] sendPush error:', err.message);
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
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const currentTime = `${hh}:${mm}`;
      const todayStr = now.toISOString().slice(0, 10);

      // Find users with reminders enabled that match current time
      const usersResult = await pool.query(
        `SELECT u.id, u.name, u.push_subscription,
                TO_CHAR(u.reminder_morning, 'HH24:MI') AS reminder_morning,
                TO_CHAR(u.reminder_evening, 'HH24:MI') AS reminder_evening
         FROM users u
         WHERE u.reminders_enabled = TRUE
           AND u.push_subscription IS NOT NULL
           AND (
             TO_CHAR(u.reminder_morning, 'HH24:MI') = $1
             OR TO_CHAR(u.reminder_evening, 'HH24:MI') = $1
           )`,
        [currentTime]
      );

      for (const user of usersResult.rows) {
        if (!user.push_subscription) continue;

        // Check if entry exists for today
        const entryResult = await pool.query(
          'SELECT m_sys_l, m_sys_r, e_sys_l, e_sys_r FROM entries WHERE user_id = $1 AND date = $2',
          [user.id, todayStr]
        );
        const entry = entryResult.rows[0] || {};

        if (user.reminder_morning === currentTime) {
          const alreadyDone = entry.m_sys_l != null || entry.m_sys_r != null;
          if (!alreadyDone) {
            await sendPush(
              user.push_subscription,
              '🌅 Час виміряти тиск',
              'Зробіть ранковий вимір — це займе хвилину.',
              { url: '/' }
            );
          }
        }

        if (user.reminder_evening === currentTime) {
          const alreadyDone = entry.e_sys_l != null || entry.e_sys_r != null;
          if (!alreadyDone) {
            await sendPush(
              user.push_subscription,
              '🌙 Час виміряти тиск',
              'Зробіть вечірній вимір — це займе хвилину.',
              { url: '/' }
            );
          }
        }
      }
    } catch (err) {
      console.error('[push] scheduleReminders error:', err.message);
    }
  });

  console.log('[push] Reminder scheduler started');
}

module.exports = { sendPush, scheduleReminders, initWebPush };
