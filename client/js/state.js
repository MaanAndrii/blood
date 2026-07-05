// ── DATA LAYER ──────────────────────────────────────────────────────────────
const DB_KEY        = 'health_entries_v2';
const APP_VERSION   = '3.07';
const REMINDER_KEY  = 'health_reminders';

// ── Constants (U) ────────────────────────────────────────────────────────────
const ROLLER_ITEM_H    = 52;   // roller item height px
const PDF_DEFAULT_DAYS = 30;   // default PDF date range
const FILTER_DEBOUNCE  = 120;  // ms debounce for filter changes
const HISTORY_MONTHS   = 3;    // max months shown in charts by default

let entries = [];
let labResults = [];
let currentUser = null;
let isDataStale = false;
let journalPage = 0;
const JOURNAL_PER_PAGE = 10;
let statsFilter = '10';
let charts = {};
let editingDate = null;
let reminderTimers = [];
let selectedWeekDate = null; // null = show today

function loadLocalData() {
  try { return JSON.parse(localStorage.getItem(DB_KEY)) || []; }
  catch { return []; }
}
function saveLocalData(arr) {
  localStorage.setItem(DB_KEY, JSON.stringify(arr));
}

// ── Loading helpers (R) ──────────────────────────────────────────────────────
function showLoading(label = 'Зачекайте…') {
  document.getElementById('loadingLabel').textContent = label;
  document.getElementById('loadingOverlay').classList.add('show');
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('show');
}

// ── Stale banner helper (S) ──────────────────────────────────────────────────
function setDataStale(stale) {
  isDataStale = stale;
  document.getElementById('staleBanner').classList.toggle('show', stale);
}

