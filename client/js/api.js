// ── API CALLS ───────────────────────────────────────────────────────────────
async function fetchEntries() {
  try {
    const r = await fetch('/api/entries');
    if (!r.ok) {
      entries = loadLocalData();
      setDataStale(true);
      return;
    }
    const data = await r.json();
    entries = data;
    saveLocalData(entries);
    setDataStale(false);
  } catch (err) {
    console.warn('fetchEntries failed, using local cache:', err);
    entries = loadLocalData();
    setDataStale(true);
  }
}

async function saveEntryToServer(entry) {
  const r = await fetch('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    const e = new Error(data.error || `${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

async function deleteEntryFromServer(date) {
  const r = await fetch('/api/entries/' + date, { method: 'DELETE' });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
}

// ── LAB RESULTS ───────────────────────────────────────────────────────────────
async function fetchLabs() {
  try {
    const r = await fetch('/api/labs');
    if (!r.ok) { labResults = []; return; }
    labResults = await r.json();
  } catch (err) {
    console.warn('fetchLabs failed:', err);
    labResults = [];
  }
}

async function saveLabToServer(lab) {
  const r = await fetch('/api/labs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lab),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${r.status}`);
  }
  return r.json();
}

async function deleteLabFromServer(date) {
  const r = await fetch('/api/labs/' + date, { method: 'DELETE' });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
}

// Re-pull the current user profile from the server
async function refreshUser() {
  try {
    const r = await fetch('/api/auth/me');
    if (r.ok) currentUser = await r.json();
  } catch {}
}

// After an import/restore, reload entries + labs + profile and re-render views
async function refreshAfterRestore() {
  await fetchEntries();
  await fetchLabs();
  await refreshUser();
  try {
    if (typeof showDayOnHome === 'function') showDayOnHome(selectedWeekDate || todayStr());
    if (typeof renderWeekStrip === 'function') renderWeekStrip();
    if (typeof renderHomeChart === 'function') renderHomeChart();
    if (typeof renderRiskCard === 'function') renderRiskCard();
    if (typeof renderLabsCard === 'function') renderLabsCard();
    const active = document.querySelector('.page.active')?.id;
    if (active === 'page-history' && typeof renderHistory === 'function') renderHistory();
    else if (active === 'page-stats' && typeof renderCharts === 'function') renderCharts();
  } catch (e) { console.error('refreshAfterRestore render failed:', e); }
}

