// ── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initApp);

// Auto-refresh when user returns to the app (switches tab or comes back from phone sleep)
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && currentUser) {
    await fetchEntries();
    showDayOnHome(selectedWeekDate || todayStr());
    renderWeekStrip();
    renderHomeChart();
    updateFabLabel();
    const activePage = document.querySelector('.page.active')?.id?.replace('page-', '');
    if (activePage === 'history') renderHistory();
    if (activePage === 'stats') renderCharts();
  }
});

// ── SWIPE NAVIGATION ─────────────────────────────────────────────────────────
(function () {
  const PAGES = ['home', 'history', 'stats', 'export'];
  let startX = 0, startY = 0;

  document.addEventListener('touchstart', e => {
    // Only on main content area
    if (e.target.closest('main')) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!e.target.closest('main')) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const cur = PAGES.findIndex(p => document.getElementById('page-' + p)?.classList.contains('active'));
    if (dx < 0 && cur < PAGES.length - 1) showPage(PAGES[cur + 1]);
    if (dx > 0 && cur > 0) showPage(PAGES[cur - 1]);
  }, { passive: true });
})();

// ── PWA INSTALL PROMPT ───────────────────────────────────────────────────────
let _installPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  const banner = document.getElementById('installBanner');
  if (banner) banner.style.display = 'flex';
});
window.addEventListener('appinstalled', () => {
  _installPrompt = null;
  const banner = document.getElementById('installBanner');
  if (banner) banner.style.display = 'none';
});
async function triggerInstall() {
  if (!_installPrompt) return;
  _installPrompt.prompt();
  const { outcome } = await _installPrompt.userChoice;
  if (outcome === 'accepted') {
    _installPrompt = null;
    const banner = document.getElementById('installBanner');
    if (banner) banner.style.display = 'none';
  }
}
function dismissInstallBanner() {
  const banner = document.getElementById('installBanner');
  if (banner) banner.style.display = 'none';
  _installPrompt = null;
}

// ── ABOUT ────────────────────────────────────────────────────────────────────
function openAboutModal() {
  document.getElementById('aboutModal').classList.add('open');
}
function closeAboutModal() {
  document.getElementById('aboutModal').classList.remove('open');
}

// ── SERVICE WORKER ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  // Show update banner when a new SW takes over (only if one was already active)
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) {
      const banner = document.getElementById('swUpdateBanner');
      if (banner) banner.style.display = 'flex';
    }
  });
}
