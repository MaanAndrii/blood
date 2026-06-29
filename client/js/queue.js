// ── PENDING ENTRY QUEUE ──────────────────────────────────────────────────────
const PENDING_KEY = 'pendingEntries';

function _getPending() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch { return []; }
}
function _setPending(list) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(list));
}

function _updateChipSync() {
  const chip = document.getElementById('userChip');
  if (!chip) return;
  const hasPending = _getPending().length > 0;
  chip.classList.toggle('sync-pending', hasPending);
  chip.classList.remove('sync-ok');
}

function _flashChipOk() {
  const chip = document.getElementById('userChip');
  if (!chip) return;
  chip.classList.remove('sync-pending');
  chip.classList.add('sync-ok');
  setTimeout(() => chip.classList.remove('sync-ok'), 2500);
}

function enqueuePendingEntry(entry) {
  const list = _getPending();
  // Replace existing entry for same date if present
  const idx = list.findIndex(e => e.date === entry.date);
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  _setPending(list);
  _updateChipSync();
}

async function flushPendingEntries() {
  const list = _getPending();
  if (!list.length) return;
  const failed = [];
  let synced = 0;
  for (const entry of list) {
    try {
      const r = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      if (r.ok) {
        const saved = await r.json();
        // Merge into local entries
        entries = entries.filter(e => String(e.date).slice(0,10) !== entry.date);
        entries.push(saved);
        entries.sort((a,b) => String(b.date).localeCompare(String(a.date)));
        saveLocalData(entries);
        synced++;
      } else if (r.status >= 400 && r.status < 500) {
        // Client error (e.g. 400 validation) — discard silently, don't retry
      } else {
        failed.push(entry); // 5xx — keep for next attempt
      }
    } catch {
      failed.push(entry); // network error — keep
    }
  }
  _setPending(failed);
  _updateChipSync();
  if (synced > 0) {
    _flashChipOk();
    showToast(`✅ Синхронізовано ${synced} ${synced === 1 ? 'запис' : 'записів'}`);
    renderWeekStrip();
    renderHomeChart();
    showDayOnHome(todayStr());
  }
}

window.addEventListener('online', () => { if (currentUser) flushPendingEntries(); });

