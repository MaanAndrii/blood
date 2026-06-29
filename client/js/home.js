// ── TODAY SUMMARY ────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function bpStr(sys, dia) {
  if (sys == null && dia == null) return '—';
  return `${sys ?? '?'}/${dia ?? '?'}`;
}

// WHO/ESH 2023 BP classification (8 categories)
function bpCategory(sys, dia) {
  if (sys == null && dia == null) return null;
  const hasBoth = sys != null && dia != null;
  if ((sys != null && sys >= 180) || (dia != null && dia >= 110))
    return { label: 'Гіпертензія 3 ст.', color: '#b91c1c' };
  if ((sys != null && sys >= 160) || (dia != null && dia >= 100))
    return { label: 'Гіпертензія 2 ст.', color: '#ef4444' };
  if (hasBoth) {
    if (sys >= 140 && dia < 90)
      return { label: 'Ізол. сист. АГ',  color: '#f97316' };
    if (sys < 140 && dia >= 90)
      return { label: 'Ізол. діаст. АГ', color: '#f97316' };
  }
  if ((sys != null && sys >= 140) || (dia != null && dia >= 90))
    return { label: 'Гіпертензія 1 ст.', color: '#f97316' };
  if ((sys != null && sys >= 130) || (dia != null && dia >= 85))
    return { label: 'Висок. нормальний', color: '#eab308' };
  if ((sys != null && sys >= 120) || (dia != null && dia >= 80))
    return { label: 'Нормальний',        color: '#84cc16' };
  return                                 { label: 'Оптимальний', color: '#22c55e' };
}

function bmiCategory(bmi) {
  if (bmi < 18.5) return { label: 'Дефіцит маси тіла', color: '#60a5fa', desc: 'Недостатня маса тіла — рекомендується консультація з лікарем' };
  if (bmi < 25)   return { label: 'Норма',              color: '#22c55e', desc: 'Нормальна маса тіла — продовжуйте підтримувати здоровий спосіб життя' };
  if (bmi < 30)   return { label: 'Надлишкова вага',    color: '#eab308', desc: 'Надлишкова маса тіла — рекомендовано збалансоване харчування та фізичну активність' };
  if (bmi < 35)   return { label: 'Ожиріння I ст.',     color: '#f97316', desc: 'Ожиріння I ступеня — підвищений ризик серцево-судинних захворювань' };
  if (bmi < 40)   return { label: 'Ожиріння II ст.',    color: '#ef4444', desc: 'Ожиріння II ступеня — значний ризик для здоров\'я, зверніться до лікаря' };
  return                  { label: 'Ожиріння III ст.',   color: '#b91c1c', desc: 'Ожиріння III ступеня — дуже високий ризик, необхідна медична допомога' };
}

function calcBmi(weightKg, heightCm) {
  if (!weightKg || !heightCm) return null;
  const m = heightCm / 100;
  return weightKg / (m * m);
}

// ── Statistics helpers ────────────────────────────────────────────────────────
function statMedian(arr) {
  const nums = arr.filter(v => v != null).map(Number).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2 * 10) / 10;
}

function statStdDev(arr) {
  const nums = arr.filter(v => v != null).map(Number);
  if (nums.length < 2) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.round(Math.sqrt(variance) * 10) / 10;
}

function statMinMax(arr) {
  const nums = arr.filter(v => v != null).map(Number);
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

function linearSlope(arr) {
  const pts = arr.map((v, i) => [i, v]).filter(([, y]) => y != null);
  if (pts.length < 2) return null;
  const n = pts.length;
  const sx = pts.reduce((s, [x]) => s + x, 0);
  const sy = pts.reduce((s, [, y]) => s + y, 0);
  const sxy = pts.reduce((s, [x, y]) => s + x * y, 0);
  const sx2 = pts.reduce((s, [x]) => s + x * x, 0);
  const den = n * sx2 - sx * sx;
  if (den === 0) return null;
  return (n * sxy - sx * sy) / den;
}

function pearsonR(xArr, yArr) {
  const pairs = xArr.map((x, i) => [x, yArr[i]]).filter(([x, y]) => x != null && y != null);
  if (pairs.length < 3) return null;
  const xs = pairs.map(p => p[0]);
  const ys = pairs.map(p => p[1]);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const dx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
  if (!dx || !dy) return null;
  return Math.round(num / (dx * dy) * 100) / 100;
}

function corrStrength(r) {
  if (r === null) return '—';
  const abs = Math.abs(r);
  const s = abs >= 0.7 ? 'сильна' : abs >= 0.4 ? 'помірна' : abs >= 0.2 ? 'слабка' : 'відсутня';
  return `${r > 0 ? '↑' : '↓'} ${s} (r = ${r})`;
}

function _updateProfileBmi() {
  const h = parseFloat(document.getElementById('profileHeight').value);
  const el = document.getElementById('profileBmiDisplay');
  const lastEntry = entries.length ? entries[0] : null;
  const w = lastEntry?.weight;
  if (!h || h < 50 || h > 250 || !w) { el.textContent = ''; return; }
  const bmi = calcBmi(w, h);
  const cat = bmiCategory(bmi);
  el.innerHTML = `ІМТ: <strong style="color:${cat.color}">${bmi.toFixed(1)}</strong> — ${cat.label} (вага ${w} кг)`;
}

function bpBadge(sys, dia) {
  const cat = bpCategory(sys, dia);
  if (!cat) return '';
  return `<span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:600;background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}66">${cat.label}</span>`;
}
// Compact badge for narrow journal-card columns
const _BP_SHORT = {
  'Оптимальний':       'Опт',
  'Нормальний':        'Норм',
  'Висок. нормальний': 'В·н',
  'Гіпертензія 1 ст.': 'Г·1',
  'Гіпертензія 2 ст.': 'Г·2',
  'Гіпертензія 3 ст.': 'Г·3',
  'Ізол. сист. АГ':    'ІС·АГ',
  'Ізол. діаст. АГ':   'ІД·АГ',
};
function bpBadgeCompact(sys, dia) {
  const cat = bpCategory(sys, dia);
  if (!cat) return '';
  const label = _BP_SHORT[cat.label] ?? cat.label;
  return `<span style="padding:1px 5px;border-radius:8px;font-size:10px;font-weight:700;background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}55;font-family:var(--font)">${label}</span>`;
}
function bpBadgeRow(sys, dia) {
  const cat = bpCategory(sys, dia);
  const inner = cat
    ? `<span style="padding:1px 8px;border-radius:10px;font-size:10px;font-weight:600;background:${cat.color}22;color:${cat.color};border:1px solid ${cat.color}66">${cat.label}</span>`
    : '';
  return `<div style="min-height:18px;margin-top:3px">${inner}</div>`;
}


function _renderSummaryInGrid(dateStr, gridId) {
  const e = entries.find(x => String(x.date).slice(0,10) === dateStr);
  const grid = document.getElementById(gridId);
  if (!grid) return;

  if (!e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:16px;color:var(--text-secondary);font-size:14px">Даних немає</div>`;
    return;
  }

  const m = e.morning, ev = e.evening;
  const bmi = e.weight ? calcBmi(e.weight, currentUser?.height_cm) : null;
  const bmiCat = bmi ? bmiCategory(bmi) : null;
  grid.innerHTML = `
    <div class="summary-col-header" style="color:var(--morning)">🌅 Ранок</div>
    <div class="summary-col-header" style="color:var(--evening)">🌙 Вечір</div>
    <div class="summary-item">
      <div class="summary-value val-sys" style="font-size:16px">${bpStr(m.sys_l, m.dia_l)}</div>
      <div class="summary-label">ліва рука</div>
      ${bpBadgeRow(m.sys_l, m.dia_l)}
    </div>
    <div class="summary-item">
      <div class="summary-value" style="font-size:16px;color:var(--evening)">${bpStr(ev.sys_l, ev.dia_l)}</div>
      <div class="summary-label">ліва рука</div>
      ${bpBadgeRow(ev.sys_l, ev.dia_l)}
    </div>
    <div class="summary-item">
      <div class="summary-value val-sys" style="font-size:16px">${bpStr(m.sys_r, m.dia_r)}</div>
      <div class="summary-label">права рука</div>
      ${bpBadgeRow(m.sys_r, m.dia_r)}
    </div>
    <div class="summary-item">
      <div class="summary-value" style="font-size:16px;color:var(--evening)">${bpStr(ev.sys_r, ev.dia_r)}</div>
      <div class="summary-label">права рука</div>
      ${bpBadgeRow(ev.sys_r, ev.dia_r)}
    </div>
    <div class="summary-item">
      <div class="summary-value val-pulse">${m.pulse ?? '—'}</div>
      <div class="summary-label">💚 Пульс</div>
      <div style="min-height:18px;margin-top:3px"></div>
    </div>
    <div class="summary-item">
      <div class="summary-value val-pulse">${ev.pulse ?? '—'}</div>
      <div class="summary-label">💚 Пульс</div>
      <div style="min-height:18px;margin-top:3px"></div>
    </div>
    ${e.weight ? `<div class="summary-item" style="grid-column:1/-1">
      <div class="summary-value val-weight">${e.weight} кг</div>
      <div class="summary-label">⚖️ Вага</div>
    </div>` : ''}
    ${e.weight && bmi ? `<div class="summary-item" style="grid-column:1/-1;background:var(--surface);border-radius:10px;padding:10px 12px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
        <span style="font-size:26px;font-weight:700;font-family:var(--mono);color:${bmiCat.color}">${bmi.toFixed(1)}</span>
        <span style="font-size:13px;font-weight:600;color:${bmiCat.color}">${bmiCat.label}</span>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:3px">${bmiCat.desc}</div>
      <div class="summary-label" style="margin-top:4px">📊 ІМТ (ВООЗ)</div>
    </div>` : e.weight && !bmi ? `<div class="summary-item" style="grid-column:1/-1">
      <div style="font-size:11px;color:var(--muted)">Вкажіть зріст у профілі для розрахунку ІМТ</div>
    </div>` : ''}
  `;
}

function renderTodaySummary() {
  _renderSummaryInGrid(selectedWeekDate || todayStr(), 'summaryGrid');
}


function showDayOnHome(dateStr) {
  const today = todayStr();
  selectedWeekDate = dateStr === today ? null : dateStr;
  const effective = selectedWeekDate || today;

  document.getElementById('sectionLabelDay1').textContent =
    effective === today ? 'Сьогодні' : fmtDate(effective);

  document.querySelectorAll('#weekStrip .week-day').forEach(el => {
    const d = el.dataset.date;
    el.classList.toggle('today',    d === today);
    el.classList.toggle('selected', d === effective && effective !== today);
  });

  renderTodaySummary();
  updateFabLabel();
}

function renderWeekStrip() {
  const strip = document.getElementById('weekStrip');
  if (!strip) return;
  const dayNames = ['Нд','Пн','Вт','Ср','Чт','Пт','Сб'];
  const today = todayStr();
  const effective = selectedWeekDate || today;
  let html = '';
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = _localDateStr(d);
    const entry = entries.find(x => String(x.date).slice(0,10) === dateStr);
    let dotClass = '';
    if (entry) {
      const hasMorning = entry.morning.sys_l != null || entry.morning.sys_r != null;
      const hasEvening = entry.evening.sys_l != null || entry.evening.sys_r != null;
      dotClass = (hasMorning && hasEvening) ? 'full' : 'partial';
    }
    let cls = 'week-day';
    if (dateStr === today) cls += ' today';
    if (dateStr === effective && effective !== today) cls += ' selected';
    html += `<div class="${cls}" data-date="${dateStr}" onclick="showDayOnHome('${dateStr}')">
      <span class="week-day-name">${dayNames[d.getDay()]}</span>
      <span class="week-day-num">${d.getDate()}</span>
      <span class="week-day-dot ${dotClass}"></span>
    </div>`;
  }
  strip.innerHTML = html;
}

// ── HOME CHART ───────────────────────────────────────────────────────────────
function renderHomeChart() {
  const today = todayStr();
  const labels = [];
  const morningData = [], eveningData = [];
  const dayNames = ['Нд','Пн','Вт','Ср','Чт','Пт','Сб'];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = _localDateStr(d);
    const e = entries.find(x => String(x.date).slice(0,10) === dateStr);
    labels.push(dayNames[d.getDay()]);
    const mSys = e ? (e.morning.sys_l ?? e.morning.sys_r ?? null) : null;
    const eSys = e ? (e.evening.sys_l ?? e.evening.sys_r ?? null) : null;
    morningData.push(mSys);
    eveningData.push(eSys);
  }

  if (charts['chartHome']) { charts['chartHome'].destroy(); charts['chartHome'] = null; }
  const canvas = document.getElementById('chartHome');
  if (!canvas) return;
  charts['chartHome'] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Ранок', data: morningData, spanGaps: true,
          borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,.08)',
          borderWidth: 2, tension: .35, pointRadius: 4,
          pointBackgroundColor: morningData.map((v, i) => {
            const d = new Date(); d.setDate(d.getDate() - (6 - i));
            return d.toISOString().slice(0,10) === today ? '#fbbf24' : '#fbbf2488';
          }),
          fill: false,
        },
        {
          label: 'Вечір', data: eveningData, spanGaps: true,
          borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,.08)',
          borderWidth: 2, tension: .35, pointRadius: 4,
          pointBackgroundColor: eveningData.map((v, i) => {
            const d = new Date(); d.setDate(d.getDate() - (6 - i));
            return d.toISOString().slice(0,10) === today ? '#818cf8' : '#818cf888';
          }),
          fill: false,
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: '#e8edf8', font: { size: 10 }, boxWidth: 14, padding: 10 } },
        tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + (ctx.parsed.y ?? '—') + ' мм' } },
      },
      scales: {
        x: { ticks: { color: '#7a8fb5', font: { size: 10 } }, grid: { color: '#2a3f6f44' } },
        y: { ticks: { color: '#7a8fb5', font: { size: 10 } }, grid: { color: '#2a3f6f44' } },
      },
    },
  });
}

// ── SMART FAB ────────────────────────────────────────────────────────────────
function _todayMeasurementState() {
  const today = todayStr();
  const e = entries.find(x => String(x.date).slice(0,10) === today);
  if (!e) return { entry: null, hasMorning: false, hasEvening: false };
  return {
    entry: e,
    hasMorning: e.morning.sys_l != null || e.morning.sys_r != null,
    hasEvening: e.evening.sys_l != null || e.evening.sys_r != null,
  };
}

function updateFabLabel() {
  const fab = document.getElementById('fabEntry');
  if (!fab) return;
  const { hasMorning, hasEvening } = _todayMeasurementState();
  if (!hasMorning && !hasEvening) {
    fab.textContent = '🌅 Внести ранкові показники';
  } else if (hasMorning && !hasEvening) {
    fab.textContent = '🌙 Внести вечірні показники';
  } else {
    fab.textContent = '📋 Оновити показники';
  }
}

function openSmartEntryModal() {
  const today = todayStr();
  const { entry, hasMorning, hasEvening } = _todayMeasurementState();

  resetRollerState();
  document.getElementById('weight').value = '';
  document.getElementById('notes').value  = '';
  editingDate = null;
  setEditMode(false);
  document.getElementById('entryDate').value = today;
  document.getElementById('entryDateRow').style.display = 'none';

  let suggestPeriod = 'morning';
  let title = '🌅 Ранкові показники';
  if (entry) {
    editingDate = today;
    setEditMode(true);
    if (hasMorning && !hasEvening) {
      suggestPeriod = 'evening';
      title = '🌙 Вечірні показники';
    } else {
      title = '📋 Оновити показники';
    }
  }

  document.getElementById('entryModalTitle').textContent = title;
  document.getElementById('entryModal').classList.add('open');

  // Open modal first so rollers can scroll; fill data in next frame
  requestAnimationFrame(() => {
    if (entry) fillFormFromEntry(entry);
    // Set suggested period after fillFormFromEntry's rAFs are queued (they run before this rAF)
    requestAnimationFrame(() => {
      if (suggestPeriod !== 'morning') setRollerPeriod(suggestPeriod);
    });
  });
}

