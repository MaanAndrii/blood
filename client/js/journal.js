// ── HISTORY ─────────────────────────────────────────────────────────────────
function filterEntries(days) {
  if (days === 'all') return entries;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(days));
  const cutStr = _localDateStr(cutoff);
  return entries.filter(e => String(e.date).slice(0,10) >= cutStr);
}

let _journalPicker = null;
let _pdfPicker     = null;

function _pickerMarkedDates() {
  return new Set(entries.map(e => String(e.date).slice(0, 10)));
}
function _pickerMinDate() {
  return entries.length ? String(entries[entries.length - 1].date).slice(0, 10) : null;
}

function _initJournalPicker() {
  if (_journalPicker) { _journalPicker.refresh(); return; }
  _journalPicker = new RangeDatePicker({
    container: 'journalDatePicker',
    onChange: () => { journalPage = 0; renderHistory(); },
    getMarkedDates: _pickerMarkedDates,
    getMinDate: _pickerMinDate,
    getMaxDate: () => todayStr(),
  });
}

function _initPdfPicker() {
  if (_pdfPicker) return;
  _pdfPicker = new RangeDatePicker({
    container: 'pdfDatePicker',
    onChange: () => {},
    getMarkedDates: _pickerMarkedDates,
    getMinDate: _pickerMinDate,
    getMaxDate: () => todayStr(),
  });
}

function _journalFiltered() {
  const from = _journalPicker ? _journalPicker.getFrom() : null;
  const to   = _journalPicker ? _journalPicker.getTo()   : null;
  return entries.filter(e => {
    const d = String(e.date).slice(0, 10);
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  });
}

function _hcolBpRow(label, sys, dia, color) {
  const val = sys != null || dia != null ? `${sys ?? '—'}/${dia ?? '—'}` : '—';
  const badge = (sys != null || dia != null) ? bpBadgeCompact(sys, dia) : '';
  return `<div class="hcol-row">
    <div class="hcol-row-label">${label}</div>
    <div class="hcol-row-val" style="color:${color}">${val}${badge}</div>
  </div>`;
}
function _hcolPulseRow(val) {
  return `<div class="hcol-row">
    <div class="hcol-row-label">Пульс</div>
    <div class="hcol-row-val" style="color:var(--accent2)">${val ?? '—'}</div>
  </div>`;
}
function _hcolArmDiff(sys_l, sys_r) {
  if (sys_l == null || sys_r == null) return '';
  const diff = Math.abs(sys_l - sys_r);
  if (diff <= 10) return '';
  return `<div class="hcol-row" style="background:rgba(249,115,22,.1)">
    <div class="hcol-row-label" style="color:#f97316">↔ Δ рук</div>
    <div class="hcol-row-val" style="color:#f97316">⚠️ ${diff} мм</div>
  </div>`;
}

function renderHistory() {
  const list = document.getElementById('historyList');
  const pag  = document.getElementById('journalPagination');
  const all  = _journalFiltered();
  const total = all.length;
  const pages = Math.max(1, Math.ceil(total / JOURNAL_PER_PAGE));
  if (journalPage >= pages) journalPage = pages - 1;
  const data = all.slice(journalPage * JOURNAL_PER_PAGE, (journalPage + 1) * JOURNAL_PER_PAGE);

  if (!total) {
    list.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>Записів поки немає.<br/>Додайте перший вимір!</p></div>`;
    pag.innerHTML = '';
    return;
  }

  // Pagination controls
  const btnStyle = (disabled) =>
    `style="padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:${disabled?'var(--muted)':'var(--text)'};font-size:13px;cursor:${disabled?'default':'pointer'};font-family:var(--font)"`;
  pag.innerHTML = `
    <button ${btnStyle(journalPage===0)} ${journalPage===0?'disabled':''} onclick="journalPage--;renderHistory()">‹</button>
    <span style="font-size:12px;color:var(--muted)">${journalPage+1} / ${pages} &nbsp;(${total})</span>
    <button ${btnStyle(journalPage>=pages-1)} ${journalPage>=pages-1?'disabled':''} onclick="journalPage++;renderHistory()">›</button>
  `;

  list.innerHTML = data.map(e => {
    const m = e.morning, ev = e.evening;
    const dateStr = String(e.date).slice(0,10);
    return `<div class="history-item" onclick="openDayModal('${dateStr}')">
      <div class="history-header">
        <span class="history-date">${fmtDate(dateStr)}</span>
        <span style="font-size:11px;color:var(--muted)">▶</span>
      </div>
      <div class="history-body">
        <div class="history-col">
          <div class="history-col-title" style="color:var(--morning)">🌅 Ранок</div>
          ${_hcolBpRow('Ліва рука', m.sys_l, m.dia_l, 'var(--morning)')}
          ${_hcolBpRow('Права рука', m.sys_r, m.dia_r, 'var(--morning)')}
          ${_hcolPulseRow(m.pulse)}
          ${_hcolArmDiff(m.sys_l, m.sys_r)}
        </div>
        <div class="history-col">
          <div class="history-col-title" style="color:var(--evening)">🌙 Вечір</div>
          ${_hcolBpRow('Ліва рука', ev.sys_l, ev.dia_l, 'var(--evening)')}
          ${_hcolBpRow('Права рука', ev.sys_r, ev.dia_r, 'var(--evening)')}
          ${_hcolPulseRow(ev.pulse)}
          ${_hcolArmDiff(ev.sys_l, ev.sys_r)}
        </div>
        ${e.weight ? `<div class="history-row" style="grid-column:1/-1">
          <span class="history-row-label">⚖️ Вага</span>
          <span class="history-row-val" style="color:var(--accent3)">${e.weight} кг</span>
        </div>` : ''}
        ${e.notes ? `<div class="history-row" style="grid-column:1/-1;align-items:flex-start">
          <span class="history-row-label">📝 Нотатки</span>
          <span class="history-row-val" style="color:var(--text);font-size:13px;font-family:var(--font);font-weight:400;white-space:pre-wrap;word-break:break-word">${escHtml(e.notes)}</span>
        </div>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function deleteEntry(date) {
  if (!confirm(`Видалити запис за ${fmtDate(date)}?`)) return;

  try {
    await deleteEntryFromServer(date);
  } catch (err) {
    showToast('⚠️ Помилка видалення: ' + err.message, 'var(--warn)');
    return;
  }

  // Only update local state after server confirms
  entries = entries.filter(e => String(e.date).slice(0,10) !== date);
  saveLocalData(entries);
  journalPage = 0;
  renderHistory();
  renderTodaySummary();
  showToast('🗑 Запис видалено', 'var(--warn)');
}

// ── DAY DETAIL MODAL ────────────────────────────────────────────────────────
let _dayModalDate = null;

function _dayModalSortedDates() {
  return entries.map(e => String(e.date).slice(0, 10)).sort();
}

function _dayModalUpdateNav() {
  const dates = _dayModalSortedDates();
  const idx = dates.indexOf(_dayModalDate);
  document.getElementById('dayNavPrev').disabled = idx <= 0;
  document.getElementById('dayNavNext').disabled = idx < 0 || idx >= dates.length - 1;
}

function dayModalNav(dir) {
  const dates = _dayModalSortedDates();
  const idx = dates.indexOf(_dayModalDate);
  const next = dates[idx + dir];
  if (next) openDayModal(next);
}

function _bpDayRow(label, sys, dia, color) {
  return `<div class="history-row">
    <span class="history-row-label">${label}</span>
    <span class="history-row-val" style="color:${color}">${sys != null || dia != null ? (sys ?? '—') + '/' + (dia ?? '—') + bpBadge(sys, dia) : '<span style="color:var(--muted)">—/—</span>'}</span>
  </div>`;
}

function _armDiffRow(sys_l, sys_r) {
  if (sys_l == null || sys_r == null) {
    return `<div class="history-row day-row-full">
      <span class="history-row-label">↔ Різниця рук</span>
      <span class="history-row-val" style="color:var(--muted)">—</span>
    </div>`;
  }
  const diff = Math.abs(sys_l - sys_r);
  if (diff > 10) {
    return `<div class="history-row day-row-full" style="background:rgba(249,115,22,.12)">
      <span class="history-row-label">⚠️ Різниця рук</span>
      <span class="history-row-val" style="color:#f97316;font-weight:600">${diff} мм — консультація лікаря</span>
    </div>`;
  }
  return `<div class="history-row day-row-full">
    <span class="history-row-label">↔ Різниця рук</span>
    <span class="history-row-val" style="color:var(--muted)">${diff} мм</span>
  </div>`;
}

function openDayModal(dateStr) {
  const e = entries.find(x => String(x.date).slice(0,10) === dateStr);
  if (!e) return;
  _dayModalDate = dateStr;
  const m = e.morning || {}, ev = e.evening || {};
  document.getElementById('dayModalTitle').textContent = fmtDate(dateStr);
  document.getElementById('dayModalBody').innerHTML = `
    <div class="day-modal-section">
      <div class="day-modal-section-title">🌅 Ранок</div>
      <div class="history-body">
        ${_bpDayRow('Ліва рука', m.sys_l, m.dia_l, 'var(--morning)')}
        ${_bpDayRow('Права рука', m.sys_r, m.dia_r, 'var(--morning)')}
        ${_armDiffRow(m.sys_l, m.sys_r)}
        <div class="history-row day-row-full">
          <span class="history-row-label">💚 Пульс</span>
          <span class="history-row-val" style="color:${m.pulse != null ? 'var(--accent2)' : 'var(--muted)'}">
            ${m.pulse != null ? m.pulse + ' уд/хв' : '—'}
          </span>
        </div>
      </div>
    </div>
    <div class="day-modal-section">
      <div class="day-modal-section-title">🌙 Вечір</div>
      <div class="history-body">
        ${_bpDayRow('Ліва рука', ev.sys_l, ev.dia_l, 'var(--evening)')}
        ${_bpDayRow('Права рука', ev.sys_r, ev.dia_r, 'var(--evening)')}
        ${_armDiffRow(ev.sys_l, ev.sys_r)}
        <div class="history-row day-row-full">
          <span class="history-row-label">💚 Пульс</span>
          <span class="history-row-val" style="color:${ev.pulse != null ? 'var(--accent2)' : 'var(--muted)'}">
            ${ev.pulse != null ? ev.pulse + ' уд/хв' : '—'}
          </span>
        </div>
      </div>
    </div>
    <div class="day-modal-section">
      <div class="history-body">
        <div class="history-row day-row-full">
          <span class="history-row-label">⚖️ Вага</span>
          <span class="history-row-val" style="color:${e.weight != null ? 'var(--accent3)' : 'var(--muted)'}">
            ${e.weight != null ? e.weight + ' кг' : '—'}
          </span>
        </div>
        <div class="history-row day-row-full" style="align-items:flex-start;padding-top:10px">
          <span class="history-row-label" style="padding-top:2px">📝 Нотатки</span>
          ${e.notes
            ? `<span class="day-row-notes-val">${escHtml(e.notes)}</span>`
            : `<span class="history-row-val" style="color:var(--muted)">—</span>`}
        </div>
      </div>
    </div>
    <div class="day-modal-actions">
      <button class="btn-edit-day" onclick="closeDayModal();editEntry('${dateStr}')">✏️ Редагувати</button>
      <button class="btn-delete-day" onclick="closeDayModal();deleteEntry('${dateStr}')">🗑 Видалити</button>
    </div>`;
  document.getElementById('dayModal').classList.add('open');
  _dayModalUpdateNav();
}

function closeDayModal() {
  document.getElementById('dayModal').classList.remove('open');
}

