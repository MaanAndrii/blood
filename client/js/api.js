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

