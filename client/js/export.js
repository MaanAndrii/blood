// ── EXPORT ───────────────────────────────────────────────────────────────────
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

async function exportCSV() {
  if (!entries.length) { showToast('⚠️ Немає даних для експорту', 'var(--warn)'); return; }
  try {
    const r = await fetch('/api/export/csv');
    if (r.status === 403) { showToast('🔒 Експорт недоступний у демо-версії', 'var(--warn)'); return; }
    if (!r.ok) throw new Error();
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'health_data.csv';
    a.click();
    showToast('📄 CSV завантажено!');
  } catch { showToast('❌ Помилка експорту', 'var(--warn)'); }
}

async function exportJSON() {
  if (!entries.length) { showToast('⚠️ Немає даних для експорту', 'var(--warn)'); return; }
  try {
    const r = await fetch('/api/export/json');
    if (r.status === 403) { showToast('🔒 Експорт недоступний у демо-версії', 'var(--warn)'); return; }
    if (!r.ok) throw new Error();
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'health_backup.json';
    a.click();
    showToast('🗄️ JSON завантажено!');
  } catch { showToast('❌ Помилка експорту', 'var(--warn)'); }
}

function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast('❌ Файл завеликий (макс. 5 МБ)', 'var(--warn)');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const data = JSON.parse(e.target.result);
      const r = await fetch('/api/export/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (r.status === 403) { showToast('🔒 Імпорт недоступний у демо-версії', 'var(--warn)'); return; }
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Помилка');
      const { imported } = await r.json();
      await fetchEntries();
      showToast(`✅ Імпортовано ${imported} записів!`);
      renderExportStats();
    } catch (err) { showToast('❌ ' + (err.message || 'Помилка файлу'), 'var(--warn)'); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function download(content, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
}

function renderExportStats() {
  const box = document.getElementById('exportStats');
  const total = entries.length;
  const latest = entries[0]?.date;
  const oldest = entries[entries.length - 1]?.date;
  const withWeight = entries.filter(e => e.weight).length;

  box.innerHTML = `
    <div class="stat-row"><span>Всього записів</span><span>${total}</span></div>
    <div class="stat-row"><span>Перший запис</span><span>${oldest ? fmtDate(String(oldest).slice(0,10)) : '—'}</span></div>
    <div class="stat-row"><span>Останній запис</span><span>${latest ? fmtDate(String(latest).slice(0,10)) : '—'}</span></div>
    <div class="stat-row"><span>Записів з вагою</span><span>${withWeight}</span></div>
  `;
}

// ── PDF EXPORT ───────────────────────────────────────────────────────────────
let _pdfMode = 'short';

function setPdfMode(m) {
  _pdfMode = m;
  document.getElementById('pdfModeShort').classList.toggle('active', m === 'short');
  document.getElementById('pdfModeExtended').classList.toggle('active', m === 'extended');
  document.getElementById('pdfModeAnnotated').classList.toggle('active', m === 'annotated');
  document.getElementById('pdfModeHint').textContent =
      m === 'extended'  ? 'Таблиця показників + статистика та аналітика (WHO/ESH 2023)'
    : m === 'annotated' ? 'Таблиця з кольоровим кодуванням тиску, позначками різниці рук і пульсу, зведеною панеллю та розшифровкою'
    : 'Таблиця показників за вибраний період';
}

function openPdfModal() {
  _initPdfPicker();
  const today = todayStr();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const fromStr = from.getFullYear() + '-'
    + String(from.getMonth() + 1).padStart(2, '0') + '-'
    + String(from.getDate()).padStart(2, '0');
  _pdfPicker.setRange(fromStr, today);
  setPdfMode('short');
  document.getElementById('pdfModal').classList.add('open');
}

function closePdfModal() {
  document.getElementById('pdfModal').classList.remove('open');
}

async function exportPDF() {
  const dateFrom = _pdfPicker ? _pdfPicker.getFrom() : null;
  const dateTo   = _pdfPicker ? _pdfPicker.getTo()   : null;

  if (!dateFrom || !dateTo) {
    showToast('⚠️ Вкажіть діапазон дат', 'var(--warn)');
    return;
  }
  if (dateFrom > dateTo) {
    showToast('⚠️ Дата "від" має бути раніше "до"', 'var(--warn)');
    return;
  }

  closePdfModal();
  showLoading('Формуємо PDF…');

  try {
    const r = await fetch('/api/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateFrom, dateTo, mode: _pdfMode }),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || 'Server error');
    }

    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `health_report_${dateFrom}_${dateTo}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    hideLoading();
    showToast('📋 PDF завантажено!');
  } catch (err) {
    hideLoading();
    showToast('❌ Помилка: ' + err.message, 'var(--warn)');
  }
}

// Close modal on overlay click
document.getElementById('pdfModal').addEventListener('click', function(e) {
  if (e.target === this) closePdfModal();
});

document.getElementById('profileModal').addEventListener('click', function(e) {
  if (e.target === this) closeProfileModal();
});

document.getElementById('entryModal').addEventListener('click', function(e) {
  if (e.target === this) closeEntryModal();
});

document.getElementById('dayModal').addEventListener('click', function(e) {
  if (e.target === this) closeDayModal();
});

// Swipe left/right in day detail modal
(function() {
  const box = document.querySelector('#dayModal .entry-modal-box');
  let startX = 0, startY = 0;
  box.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  box.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    dayModalNav(dx < 0 ? 1 : -1);
  }, { passive: true });
})();

document.getElementById('driveModal').addEventListener('click', function(e) {
  if (e.target === this) closeDriveModal();
});

