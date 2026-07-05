// ── LAB RESULTS (labs.js) ───────────────────────────────────────────────────
// Dated blood-work panels (lipids + HbA1c). Rendered as a card on the «Аналіз»
// tab; the latest panel feeds the cardiovascular-risk models. Reference targets
// follow ESC 2021/2019 for the "very high risk" region (Ukraine): LDL < 1.4,
// non-HDL < 2.2 mmol/L.

const LAB_META = {
  hba1c:         { label: 'Глікований гемоглобін', unit: '%',      target: 'норма < 5.7' },
  total_chol:    { label: 'Загальний холестерин',  unit: 'ммоль/л', target: 'бажано < 5.0' },
  hdl:           { label: 'ЛПВЩ (HDL)',            unit: 'ммоль/л', target: 'що вище — краще' },
  ldl:           { label: 'ЛПНЩ (LDL)',            unit: 'ммоль/л', target: 'ціль < 1.4' },
  triglycerides: { label: 'Тригліцериди',          unit: 'ммоль/л', target: 'норма < 1.7' },
};

const LAB_GREEN = '#22c55e', LAB_AMBER = '#eab308', LAB_RED = '#ef4444', LAB_MUTED = 'var(--muted)';

function _nf(v) { return v == null ? '—' : String(+(+v).toFixed(2)); }

// Evaluate a value against reference ranges → { color, note }
function _labEval(key, v, sex) {
  if (v == null) return { color: LAB_MUTED, note: '' };
  switch (key) {
    case 'hba1c':
      if (v < 5.7) return { color: LAB_GREEN, note: 'норма' };
      if (v < 6.5) return { color: LAB_AMBER, note: 'предіабет' };
      return { color: LAB_RED, note: 'діабет' };
    case 'total_chol':
      if (v < 5.0) return { color: LAB_GREEN, note: 'оптимально' };
      if (v < 6.2) return { color: LAB_AMBER, note: 'погранично' };
      return { color: LAB_RED, note: 'підвищено' };
    case 'hdl': {
      const low = sex === 'female' ? 1.2 : 1.0;
      return v >= low ? { color: LAB_GREEN, note: 'захисний' } : { color: LAB_AMBER, note: 'низький' };
    }
    case 'triglycerides':
      if (v < 1.7) return { color: LAB_GREEN, note: 'норма' };
      if (v < 2.3) return { color: LAB_AMBER, note: 'погранично' };
      return { color: LAB_RED, note: 'підвищено' };
    case 'ldl':
      if (v < 1.4) return { color: LAB_GREEN, note: 'ціль досягнута' };
      if (v < 1.8) return { color: LAB_AMBER, note: 'близько до цілі' };
      return { color: LAB_RED, note: 'вище цілі' };
    default:
      return { color: LAB_MUTED, note: '' };
  }
}

function _nonHdlEval(v) {
  if (v < 2.2) return { color: LAB_GREEN, note: 'ціль досягнута' };
  if (v < 3.4) return { color: LAB_AMBER, note: 'близько до цілі' };
  return { color: LAB_RED, note: 'вище цілі' };
}

function renderLabsCard() {
  const el = document.getElementById('labsCard');
  if (!el) return;
  const sex = currentUser?.sex;

  if (!Array.isArray(labResults) || !labResults.length) {
    el.innerHTML = `
      <div class="stat-card" style="margin-bottom:10px">
        <div class="stat-title">🧪 Лабораторні показники</div>
        <div style="font-size:12px;color:var(--muted);margin:6px 0 10px">
          Додайте результати аналізу крові (ліпідограма + HbA1c) — вони використовуються для оцінки ризику й ліпідних цілей.
        </div>
        <button class="btn-outline" style="width:100%" onclick="openLabModal()">＋ Додати аналіз</button>
      </div>`;
    return;
  }

  const lab = labResults[0];
  const rows = ['hba1c', 'total_chol', 'hdl', 'ldl', 'triglycerides'].map(key => {
    const v = lab[key];
    const { color, note } = _labEval(key, v, sex);
    return `<div class="lab-row">
      <span class="lab-row-name">${LAB_META[key].label}</span>
      <span class="lab-row-val" style="color:${v == null ? 'var(--muted)' : color}">${_nf(v)}${v == null ? '' : ' <span style="font-size:10px;color:var(--muted)">' + LAB_META[key].unit + '</span>'}</span>
      <span class="lab-row-note" style="color:${color}">${note}</span>
    </div>`;
  }).join('');

  // Derived values
  let derived = '';
  if (lab.total_chol != null && lab.hdl != null) {
    const nonHdl = +(lab.total_chol - lab.hdl).toFixed(2);
    const ev = _nonHdlEval(nonHdl);
    derived += `<div class="lab-row">
      <span class="lab-row-name">non-HDL <span style="font-size:10px;color:var(--muted)">(розрах.)</span></span>
      <span class="lab-row-val" style="color:${ev.color}">${nonHdl} <span style="font-size:10px;color:var(--muted)">ммоль/л</span></span>
      <span class="lab-row-note" style="color:${ev.color}">${ev.note}</span>
    </div>`;
  }
  if (lab.triglycerides != null && lab.hdl != null && lab.hdl > 0) {
    const ratio = +(lab.triglycerides / lab.hdl).toFixed(2);
    derived += `<div class="lab-row">
      <span class="lab-row-name">TG/HDL <span style="font-size:10px;color:var(--muted)">(розрах.)</span></span>
      <span class="lab-row-val" style="color:var(--text)">${ratio}</span>
      <span class="lab-row-note" style="color:var(--muted)">${ratio < 2 ? 'сприятливо' : ratio < 3 ? 'погранично' : 'високий'}</span>
    </div>`;
  }

  // Friedewald cross-check (valid when TG < 4.5)
  let note = '';
  if (lab.total_chol != null && lab.hdl != null && lab.triglycerides != null && lab.ldl != null && lab.triglycerides < 4.5) {
    const calc = lab.total_chol - lab.hdl - lab.triglycerides / 2.2;
    if (Math.abs(calc - lab.ldl) > 0.5) {
      note = `<div style="font-size:10px;color:${LAB_AMBER};margin-top:6px;line-height:1.4">
        ⚠️ Виміряний ЛПНЩ (${_nf(lab.ldl)}) відрізняється від розрахунку за Фрідевальдом (${calc.toFixed(1)}) більш ніж на 0.5 ммоль/л — варто перепровірити аналіз.
      </div>`;
    }
  }

  // Diabetes status derived from HbA1c
  let dm = '';
  if (lab.hba1c != null) {
    const st = lab.hba1c >= 6.5 ? { t: 'діабет', c: LAB_RED } : lab.hba1c >= 5.7 ? { t: 'предіабет', c: LAB_AMBER } : { t: 'без діабету', c: LAB_GREEN };
    dm = `<div style="font-size:11px;color:var(--muted);margin-top:8px">Статус за HbA1c: <strong style="color:${st.c}">${st.t}</strong> — враховано в оцінці ризику.</div>`;
  }

  el.innerHTML = `
    <div class="stat-card" style="margin-bottom:10px">
      <div class="stat-title">🧪 Лабораторні показники</div>
      <div style="font-size:11px;color:var(--muted);margin:2px 0 8px">Останній аналіз: ${fmtDate(lab.date)}</div>
      ${rows}${derived}
      ${note}
      ${dm}
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn-outline" style="flex:1" onclick="openLabModal('${lab.date}')">✏️ Редагувати</button>
        <button class="btn-outline" style="flex:1" onclick="openLabModal()">＋ Додати</button>
      </div>
      ${_labHistoryHtml()}
    </div>`;
}

function _labHistoryHtml() {
  if (labResults.length < 2) return '';
  const items = labResults.slice(0, 8).map(l => {
    const parts = [];
    if (l.hba1c != null) parts.push(`HbA1c ${_nf(l.hba1c)}%`);
    if (l.ldl != null) parts.push(`ЛПНЩ ${_nf(l.ldl)}`);
    if (l.total_chol != null) parts.push(`заг ${_nf(l.total_chol)}`);
    return `<div class="lab-hist-row">
      <span onclick="openLabModal('${l.date}')" style="flex:1;cursor:pointer">
        <strong style="font-size:12px">${fmtDate(l.date)}</strong>
        <span style="font-size:11px;color:var(--muted);margin-left:6px">${parts.join(' · ') || '—'}</span>
      </span>
      <button class="lab-del" onclick="deleteLab('${l.date}')" title="Видалити">🗑</button>
    </div>`;
  }).join('');
  return `<details style="margin-top:10px">
    <summary style="font-size:12px;color:var(--muted);cursor:pointer">Історія аналізів (${labResults.length})</summary>
    <div style="margin-top:6px">${items}</div>
  </details>`;
}

// ── Add / edit modal ──────────────────────────────────────────────────────────
let _labPicker = null;
let _labSelectedDate = null;

function openLabModal(date) {
  const existing = date ? labResults.find(l => l.date === date) : null;
  document.getElementById('labModalTitle').textContent = existing ? 'Редагувати аналіз' : 'Новий аналіз';
  document.getElementById('labHba1c').value = existing?.hba1c ?? '';
  document.getElementById('labTotalChol').value = existing?.total_chol ?? '';
  document.getElementById('labHdl').value = existing?.hdl ?? '';
  document.getElementById('labLdl').value = existing?.ldl ?? '';
  document.getElementById('labTg').value = existing?.triglycerides ?? '';
  // Open the modal FIRST so a date-picker hiccup can never make the button dead.
  document.getElementById('labModal').classList.add('open');
  _labSelectedDate = date || todayStr();
  try {
    if (!_labPicker && typeof RangeDatePicker === 'function') {
      _labPicker = new RangeDatePicker({
        container: 'labDatePicker',
        single: true,
        label: 'Дата аналізу',
        getMarkedDates: () => new Set(labResults.map(l => l.date)),
        getMaxDate: () => todayStr(),
        onChange: d => { _labSelectedDate = d; },
      });
    }
    if (_labPicker && typeof _labPicker.setDate === 'function') _labPicker.setDate(_labSelectedDate);
  } catch (err) {
    console.error('lab date picker init failed:', err);
  }
}

function closeLabModal() {
  document.getElementById('labModal').classList.remove('open');
}

async function saveLab() {
  const val = id => {
    const raw = document.getElementById(id).value;
    return raw === '' ? null : parseFloat(raw);
  };
  const pickedDate = (_labPicker && typeof _labPicker.getDate === 'function' && _labPicker.getDate())
    || _labSelectedDate || todayStr();
  const payload = {
    date:          pickedDate,
    hba1c:         val('labHba1c'),
    total_chol:    val('labTotalChol'),
    hdl:           val('labHdl'),
    ldl:           val('labLdl'),
    triglycerides: val('labTg'),
  };
  if (!payload.date) { showToast('⚠️ Вкажіть дату', 'var(--warn)'); return; }
  if (['hba1c', 'total_chol', 'hdl', 'ldl', 'triglycerides'].every(k => payload[k] == null)) {
    showToast('⚠️ Введіть хоча б одне значення', 'var(--warn)'); return;
  }
  showLoading('Збереження аналізу…');
  try {
    await saveLabToServer(payload);
    await fetchLabs();
    hideLoading();
    closeLabModal();
    renderLabsCard();
    renderRiskCard();
    showToast('✅ Аналіз збережено');
  } catch (err) {
    hideLoading();
    showToast('⚠️ ' + err.message, 'var(--warn)');
  }
}

async function deleteLab(date) {
  if (!confirm(`Видалити аналіз від ${fmtDate(date)}?`)) return;
  showLoading('Видалення…');
  try {
    await deleteLabFromServer(date);
    await fetchLabs();
    hideLoading();
    renderLabsCard();
    renderRiskCard();
    showToast('🗑 Аналіз видалено');
  } catch (err) {
    hideLoading();
    showToast('⚠️ ' + err.message, 'var(--warn)');
  }
}
