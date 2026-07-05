// ── HELPERS ─────────────────────────────────────────────────────────────────
function todayStr() {
  return _localDateStr(new Date());
}
function _localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtDate(str) {
  if (!str) return '';
  const s = String(str).slice(0, 10);
  const [y,m,d] = s.split('-');
  return `${d}.${m}.${y}`;
}
function v(id) {
  const val = document.getElementById(id).value;
  return val === '' ? null : Number(val);
}

// ── TOAST ───────────────────────────────────────────────────────────────────
function showToast(msg, color) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = color || 'var(--accent2)';
  t.style.color = color ? '#fff' : '#052e16';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ── NAV ─────────────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + name)?.classList.add('active');
  document.querySelector(`.tab[data-page="${name}"]`)?.classList.add('active');
  window.scrollTo(0, 0);
  if (name === 'home')    { showDayOnHome(selectedWeekDate || todayStr()); renderWeekStrip(); renderHomeChart(); renderLabsCard(); updateFabLabel(); }
  if (name === 'history') renderHistory();
  if (name === 'stats')   renderCharts();
  if (name === 'export')  { renderExportStats(); renderRemindersUI(); }
}

window.addEventListener('scroll', () => {
  document.getElementById('scrollTopBtn').classList.toggle('visible', window.scrollY > 200);
}, { passive: true });

