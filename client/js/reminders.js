// ── REMINDERS ────────────────────────────────────────────────────────────────
function loadReminderSettings() {
  try { return JSON.parse(localStorage.getItem(REMINDER_KEY)) || {}; }
  catch { return {}; }
}

async function saveReminderSettings() {
  const tzEl = document.getElementById('reminderTimezone');
  const s = {
    enabled:  document.getElementById('remindersEnabled').checked,
    morning:  document.getElementById('reminderMorning').value,
    evening:  document.getElementById('reminderEvening').value,
    timezone: tzEl ? tzEl.value : Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  localStorage.setItem(REMINDER_KEY, JSON.stringify(s));
  scheduleReminders(s);

  // Save to server + handle push subscription
  const syncEl = document.getElementById('reminderSyncStatus');
  if (syncEl) syncEl.innerHTML = '<span style="color:var(--muted)">⏳ Синхронізація…</span>';
  try {
    const payload = { morning: s.morning, evening: s.evening, enabled: s.enabled, timezone: s.timezone };
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      if (s.enabled) {
        const sub = await initPushSubscription(s);
        if (sub !== null) payload.subscription = sub;
      } else {
        payload.subscription = null;
      }
    }
    await savePushSettingsToServer(payload);
    if (syncEl) syncEl.innerHTML = '<span style="color:#22c55e">✅ Синхронізовано з сервером</span>';
  } catch (err) {
    console.warn('savePushSettings failed:', err);
    if (syncEl) syncEl.innerHTML = '<span style="color:var(--warn)">⚠️ Лише локально — push можуть не працювати</span>';
    showToast('⚠️ Нагадування збережено локально. Push-сповіщення можуть не працювати', 'var(--warn)');
  }
}

async function savePushSettingsToServer(settings) {
  await fetch('/api/push/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

async function initPushSubscription(s) {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.pushManager) return null;

    // Try to get existing subscription
    let sub = await reg.pushManager.getSubscription();

    if (!sub && s.enabled && Notification.permission === 'granted') {
      // Fetch VAPID public key
      try {
        const r = await fetch('/api/push/vapid-public-key');
        if (r.ok) {
          const { publicKey } = await r.json();
          if (publicKey) {
            sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(publicKey),
            });
          }
        }
      } catch {}
    }

    return sub ? sub.toJSON() : null;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function renderRemindersUI() {
  const s = loadReminderSettings();
  document.getElementById('remindersEnabled').checked  = s.enabled  ?? false;
  document.getElementById('reminderMorning').value     = s.morning  || '08:00';
  document.getElementById('reminderEvening').value     = s.evening  || '20:00';
  const tzEl = document.getElementById('reminderTimezone');
  if (tzEl) {
    const savedTz = s.timezone || currentUser?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    // try to select matching option, otherwise add dynamically
    const opt = [...tzEl.options].find(o => o.value === savedTz);
    if (opt) { tzEl.value = savedTz; }
    else if (savedTz) {
      const newOpt = new Option(savedTz, savedTz);
      tzEl.add(newOpt);
      tzEl.value = savedTz;
    }
  }

  // Check if VAPID is configured on server; also read server timezone
  try {
    const r = await fetch('/api/push/vapid-public-key');
    document.getElementById('vapidStatus').style.display = r.ok ? 'none' : '';
  } catch {
    document.getElementById('vapidStatus').style.display = '';
  }
  try {
    const h = await fetch('/api/health');
    if (h.ok) {
      const { tz } = await h.json();
      const tzEl = document.getElementById('serverTzHint');
      if (tzEl && tz) tzEl.textContent = `⏰ Часовий пояс сервера: ${tz}`;
    }
  } catch {}

  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const statusEl  = document.getElementById('notifStatus');
  const btnEl     = document.getElementById('btnNotifPermission');
  const btnTestEl = document.getElementById('btnTestPush');

  if (perm === 'granted') {
    statusEl.className = 'notif-status granted';
    statusEl.textContent = '✅ Сповіщення дозволено';
    btnEl.style.display = 'none';
    btnTestEl.style.display = 'flex';
    // Show subscription DB status
    fetch('/api/push/status').then(r => r.json()).then(data => {
      const el = document.getElementById('pushSubStatus');
      if (!el) return;
      if (data.has_subscription) {
        el.textContent = '✅ Підписка збережена на сервері — фонові сповіщення активні';
        el.style.color = 'var(--ok, #4ade80)';
      } else {
        el.textContent = '⚠️ Підписка НЕ збережена на сервері. Вимкніть і увімкніть нагадування знову.';
        el.style.color = 'var(--warn, #fb923c)';
      }
      el.style.display = 'block';
    }).catch(() => {});
  } else if (perm === 'denied') {
    statusEl.className = 'notif-status denied';
    statusEl.textContent = '🚫 Сповіщення заблоковано браузером. Дозвольте їх у налаштуваннях сайту.';
    btnEl.style.display = 'none';
    btnTestEl.style.display = 'none';
  } else if (perm === 'unsupported') {
    statusEl.className = 'notif-status denied';
    statusEl.textContent = '⚠️ Ваш браузер не підтримує сповіщення';
    btnEl.style.display = 'none';
    btnTestEl.style.display = 'none';
  } else {
    statusEl.className = 'notif-status default';
    statusEl.textContent = '💡 Натисніть кнопку нижче, щоб дозволити сповіщення';
    btnEl.style.display = 'flex';
    btnTestEl.style.display = 'none';
  }
}

async function requestNotifPermission() {
  if (!('Notification' in window)) return;
  const result = await Notification.requestPermission();
  renderRemindersUI();
  if (result === 'granted') {
    const s = loadReminderSettings();
    scheduleReminders(s);
    await saveReminderSettings();
    showToast('🔔 Сповіщення увімкнено!');
  }
}

async function sendTestPush() {
  const btn = document.getElementById('btnTestPush');
  btn.disabled = true;
  btn.textContent = '⏳ Надсилаємо...';
  try {
    const r = await fetch('/api/push/test', { method: 'POST' });
    const data = await r.json();
    if (r.ok) {
      showToast('📳 Тестове сповіщення надіслано!');
    } else if (data.error === 'no_subscription') {
      showToast('⚠️ Підписка не збережена. Спробуйте вимкнути і увімкнути нагадування знову.');
    } else {
      showToast('❌ Помилка надсилання: ' + (data.error || r.status));
    }
  } catch {
    showToast('❌ Помилка мережі');
  } finally {
    btn.disabled = false;
    btn.textContent = '📳 Надіслати тестове сповіщення';
  }
}

// Client-side fallback reminders (when app is open)
function scheduleReminders(s) {
  reminderTimers.forEach(clearTimeout);
  reminderTimers = [];
  if (!s?.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;

  [['morning', s.morning || '08:00'], ['evening', s.evening || '20:00']].forEach(([type, time]) => {
    const [h, m] = time.split(':').map(Number);
    const now = new Date();
    const target = new Date(now);
    target.setHours(h, m, 0, 0);

    let delay = target - now;
    if (delay <= 0) delay += 24 * 60 * 60 * 1000;

    const label  = type === 'morning' ? 'ранковий' : 'вечірній';
    const emoji  = type === 'morning' ? '🌅' : '🌙';

    const tid = setTimeout(async () => {
      const todayEntry = entries.find(e => String(e.date).slice(0,10) === todayStr());
      const alreadyDone = todayEntry && (
        type === 'morning'
          ? todayEntry.morning.sys_l != null || todayEntry.morning.sys_r != null
          : todayEntry.evening.sys_l != null || todayEntry.evening.sys_r != null
      );
      if (alreadyDone) { scheduleReminders(loadReminderSettings()); return; }

      try {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification(`${emoji} Час виміряти тиск`, {
          body: `Зробіть ${label} вимір — це займе хвилину.`,
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="36" fill="%231a2744"/><text y="130" x="96" text-anchor="middle" font-size="110">❤️</text></svg>',
          tag: `reminder-${type}`,
          renotify: true,
          data: { url: '/' }
        });
      } catch {
        new Notification(`${emoji} Час виміряти тиск`, {
          body: `Зробіть ${label} вимір — це займе хвилину.`,
          tag: `reminder-${type}`
        });
      }

      scheduleReminders(loadReminderSettings());
    }, delay);

    reminderTimers.push(tid);
  });
}

