const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

function escHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDateUk(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${d.getUTCFullYear()}`;
}

function fmtVal(v) { return v != null ? String(v) : '—'; }

function bpStr(sys, dia) {
  if (sys == null && dia == null) return '—';
  return `${fmtVal(sys)}/${fmtVal(dia)}`;
}

function avg(values) {
  const nums = values.filter(v => v != null).map(Number);
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length * 10) / 10;
}

function median(values) {
  const nums = values.filter(v => v != null).map(Number).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Math.round((nums[mid-1] + nums[mid]) / 2 * 10) / 10;
}

function stdDev(values) {
  const nums = values.filter(v => v != null).map(Number);
  if (nums.length < 2) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.round(Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length) * 10) / 10;
}

function minMax(values) {
  const nums = values.filter(v => v != null).map(Number);
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

function pearsonR(xArr, yArr) {
  const pairs = xArr.map((x, i) => [x, yArr[i]]).filter(([x, y]) => x != null && y != null);
  if (pairs.length < 3) return null;
  const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const dx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
  if (!dx || !dy) return null;
  return Math.round(num / (dx * dy) * 100) / 100;
}

function corrLabel(r) {
  if (r === null) return '—';
  const abs = Math.abs(r);
  const strength = abs >= 0.7 ? 'сильна' : abs >= 0.4 ? 'помірна' : abs >= 0.2 ? 'слабка' : 'відсутня';
  return `${r} (${r > 0 ? '↑' : '↓'} ${strength})`;
}

function linearSlope(arr) {
  const pts = arr.map((v, i) => [i, v]).filter(([, y]) => y != null);
  if (pts.length < 2) return null;
  const n = pts.length;
  const sx  = pts.reduce((s, [x])    => s + x,   0);
  const sy  = pts.reduce((s, [, y])  => s + y,   0);
  const sxy = pts.reduce((s, [x, y]) => s + x*y, 0);
  const sx2 = pts.reduce((s, [x])    => s + x*x, 0);
  const den = n * sx2 - sx * sx;
  return den === 0 ? null : (n * sxy - sx * sy) / den;
}

function trendStr(arr, threshold, decimals) {
  const slope = linearSlope(arr);
  if (slope == null) return '—';
  const total = slope * (arr.length - 1);
  if (Math.abs(total) < threshold) return 'без змін';
  const val = decimals ? Math.abs(total).toFixed(decimals) : Math.round(Math.abs(total));
  return (total < 0 ? '↓ ' : '↑ ') + val;
}

function bpCategoryLabel(sys, dia) {
  if (sys == null && dia == null) return '—';
  if ((sys != null && sys >= 180) || (dia != null && dia >= 110)) return 'Гіпертензія 3 ст.';
  if ((sys != null && sys >= 160) || (dia != null && dia >= 100)) return 'Гіпертензія 2 ст.';
  if (sys != null && dia != null) {
    if (sys >= 140 && dia < 90) return 'Ізол. сист. АГ';
    if (sys < 140 && dia >= 90) return 'Ізол. діаст. АГ';
  }
  if ((sys != null && sys >= 140) || (dia != null && dia >= 90)) return 'Гіпертензія 1 ст.';
  if ((sys != null && sys >= 130) || (dia != null && dia >= 85)) return 'Висок. нормальний';
  if ((sys != null && sys >= 120) || (dia != null && dia >= 80)) return 'Нормальний';
  return 'Оптимальний';
}

// ── Health-status colour coding (coloured report) ────────────────────────────
// Status palette (good/warning/serious/critical) — reserved for severity, not
// arbitrary category hues. Colour is a light cell tint (dark-ish text stays
// legible in B/W); an icon duplicates the status so colour is never the only
// signal (none / ⚠ / ‼).
const BP_STATUS_STYLE = {
  good:     { bg: '#e6f5e6', fg: '#0a7d0a', icon: '' },
  warning:  { bg: '#fdf3d9', fg: '#8a6100', icon: '⚠' },
  serious:  { bg: '#fbe6db', fg: '#a8481a', icon: '⚠' },
  critical: { bg: '#f8dada', fg: '#a81f1f', icon: '‼' },
};
const BP_CAT_STATUS = {
  'Оптимальний': 'good', 'Нормальний': 'good',
  'Висок. нормальний': 'warning', 'Гіпертензія 1 ст.': 'warning',
  'Ізол. сист. АГ': 'serious', 'Ізол. діаст. АГ': 'serious', 'Гіпертензія 2 ст.': 'serious',
  'Гіпертензія 3 ст.': 'critical',
};
const STATUS_ORDER = { good: 0, warning: 1, serious: 2, critical: 3 };

function bpStatus(sys, dia) {
  const cat = bpCategoryLabel(sys, dia);
  if (cat === '—') return null;
  const status = BP_CAT_STATUS[cat];
  return status ? { status, cat, ...BP_STATUS_STYLE[status] } : null;
}

// A coloured <td> for a BP reading
function bpCell(sys, dia) {
  const val = bpStr(sys, dia);
  const s = bpStatus(sys, dia);
  if (!s) return `<td>${val}</td>`;
  return `<td style="background:${s.bg};color:${s.fg};font-weight:600">${val}${s.icon ? ' ' + s.icon : ''}</td>`;
}

// A pulse <td> marked ↓ (<60, bradycardia) / ↑ (>100, tachycardia)
function pulseCell(p) {
  if (p == null) return '<td>—</td>';
  if (p < 60)  return `<td style="color:#1c6fb4;font-weight:600">${p} ↓</td>`;
  if (p > 100) return `<td style="color:#a81f1f;font-weight:600">${p} ↑</td>`;
  return `<td>${p}</td>`;
}

// True when a day has a systolic arm difference >10 mmHg (morning or evening)
function armDiffFlag(e) {
  const md = e.m_sys_l != null && e.m_sys_r != null && Math.abs(e.m_sys_l - e.m_sys_r) > 10;
  const ed = e.e_sys_l != null && e.e_sys_r != null && Math.abs(e.e_sys_l - e.e_sys_r) > 10;
  return md || ed;
}

// Worst BP status across a day's four readings (for the period-overview panel)
function dayWorstStatus(e) {
  let worst = null;
  for (const [s, d] of [[e.m_sys_l, e.m_dia_l], [e.m_sys_r, e.m_dia_r], [e.e_sys_l, e.e_dia_l], [e.e_sys_r, e.e_dia_r]]) {
    const st = bpStatus(s, d);
    if (st && (worst == null || STATUS_ORDER[st.status] > STATUS_ORDER[worst])) worst = st.status;
  }
  return worst;
}

// ── Lab-result helpers (ESC very-high-risk targets) ──────────────────────────
function labNum(v) { return v != null ? Number(v) : null; }
function fmtLab(v) { return v != null ? String(+Number(v).toFixed(2)) : '—'; }

function labEvalText(key, v, sex) {
  if (v == null) return '';
  switch (key) {
    case 'hba1c':         return v < 5.7 ? 'норма' : v < 6.5 ? 'предіабет' : 'діабет';
    case 'total_chol':    return v < 5.0 ? 'оптимально' : v < 6.2 ? 'погранично' : 'підвищено';
    case 'hdl':           return v >= (sex === 'female' ? 1.2 : 1.0) ? 'захисний' : 'низький';
    case 'triglycerides': return v < 1.7 ? 'норма' : v < 2.3 ? 'погранично' : 'підвищено';
    case 'ldl':           return v < 1.4 ? 'ціль ✓' : v < 1.8 ? 'близько до цілі' : 'вище цілі';
    default:              return '';
  }
}

// Lab value → severity status (reuses the BP status palette)
function labStatus(key, v, sex) {
  if (v == null) return null;
  switch (key) {
    case 'hba1c':         return v < 5.7 ? 'good' : v < 6.5 ? 'warning' : 'critical';
    case 'total_chol':    return v < 5.0 ? 'good' : v < 6.2 ? 'warning' : 'serious';
    case 'hdl':           return v >= (sex === 'female' ? 1.2 : 1.0) ? 'good' : 'warning';
    case 'triglycerides': return v < 1.7 ? 'good' : v < 2.3 ? 'warning' : 'serious';
    case 'ldl':           return v < 1.4 ? 'good' : v < 1.8 ? 'warning' : 'critical';
    case 'nonhdl':        return v < 2.2 ? 'good' : v < 3.4 ? 'warning' : 'serious';
    default:              return null;
  }
}

// Coloured <td> for a lab value
function labCell(key, v, sex) {
  const txt = fmtLab(v);
  const st = labStatus(key, v, sex);
  if (!st) return `<td>${txt}</td>`;
  const s = BP_STATUS_STYLE[st];
  return `<td style="background:${s.bg};color:${s.fg};font-weight:600">${txt}</td>`;
}

const _iconPath = path.join(__dirname, '..', '..', 'client', 'icons', 'icon-192.svg');
const _iconSvgRaw = fs.readFileSync(_iconPath, 'utf8');
const LOGO_SVG = _iconSvgRaw
  .replace(/<\?xml[^?]*\?>/, '')
  .replace(/<svg /, '<svg width="56" height="56" ');

function buildHtml(user, entries, labs, dateFrom, dateTo, mode = 'short') {
  labs = Array.isArray(labs) ? labs : [];
  const today = fmtDateUk(new Date().toISOString().slice(0, 10));
  const dob = user.date_of_birth ? fmtDateUk(user.date_of_birth) : '—';
  let age = '—';
  if (user.date_of_birth) {
    const birth = new Date(user.date_of_birth);
    const now = new Date();
    let years = now.getUTCFullYear() - birth.getUTCFullYear();
    const notYet = now.getUTCMonth() < birth.getUTCMonth() ||
      (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate());
    if (notYet) years--;
    age = years >= 0 ? years + ' р.' : '—';
  }

  const filtered = entries.filter(e => {
    const d = String(e.date).slice(0, 10);
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  }).sort((a, b) => String(a.date).slice(0,10).localeCompare(String(b.date).slice(0,10)));

  const hasNotes = filtered.some(e => e.notes);

  // ── Table rows ────────────────────────────────────────────────────────────
  const rows = filtered.map(e => `
    <tr>
      <td>${fmtDateUk(String(e.date).slice(0,10))}${armDiffFlag(e) ? ' <span title="Різниця рук >10 мм">⚖️</span>' : ''}</td>
      ${bpCell(e.m_sys_l, e.m_dia_l)}
      ${bpCell(e.m_sys_r, e.m_dia_r)}
      ${pulseCell(e.m_pulse)}
      ${bpCell(e.e_sys_l, e.e_dia_l)}
      ${bpCell(e.e_sys_r, e.e_dia_r)}
      ${pulseCell(e.e_pulse)}
      <td>${e.weight != null ? parseFloat(e.weight).toFixed(1) : '—'}</td>
      ${hasNotes ? `<td style="text-align:left;font-size:9px">${escHtml(e.notes) || ''}</td>` : ''}
    </tr>`).join('');

  const avgRow = `
    <tr class="avg-row">
      <td><strong>Середнє</strong></td>
      <td>${avg(filtered.map(e=>e.m_sys_l)) != null ? avg(filtered.map(e=>e.m_sys_l))+'/'+avg(filtered.map(e=>e.m_dia_l)) : '—'}</td>
      <td>${avg(filtered.map(e=>e.m_sys_r)) != null ? avg(filtered.map(e=>e.m_sys_r))+'/'+avg(filtered.map(e=>e.m_dia_r)) : '—'}</td>
      <td>${avg(filtered.map(e=>e.m_pulse)) ?? '—'}</td>
      <td>${avg(filtered.map(e=>e.e_sys_l)) != null ? avg(filtered.map(e=>e.e_sys_l))+'/'+avg(filtered.map(e=>e.e_dia_l)) : '—'}</td>
      <td>${avg(filtered.map(e=>e.e_sys_r)) != null ? avg(filtered.map(e=>e.e_sys_r))+'/'+avg(filtered.map(e=>e.e_dia_r)) : '—'}</td>
      <td>${avg(filtered.map(e=>e.e_pulse)) ?? '—'}</td>
      <td>${avg(filtered.map(e=>e.weight!=null?parseFloat(e.weight):null)) ?? '—'}</td>
      ${hasNotes ? '<td></td>' : ''}
    </tr>`;

  // ── Statistics data ───────────────────────────────────────────────────────
  const mSysL  = filtered.map(e => e.m_sys_l);
  const mDiaL  = filtered.map(e => e.m_dia_l);
  const mSysR  = filtered.map(e => e.m_sys_r);
  const mDiaR  = filtered.map(e => e.m_dia_r);
  const eSysL  = filtered.map(e => e.e_sys_l);
  const eDiaL  = filtered.map(e => e.e_dia_l);
  const eSysR  = filtered.map(e => e.e_sys_r);
  const eDiaR  = filtered.map(e => e.e_dia_r);
  const mPulse = filtered.map(e => e.m_pulse);
  const ePulse = filtered.map(e => e.e_pulse);
  const weights = filtered.map(e => e.weight != null ? parseFloat(e.weight) : null);

  // All-columns averages (for MAP and WHO/ESH)
  const avgSysAll = avg([...mSysL, ...mSysR, ...eSysL, ...eSysR]);
  const avgDiaAll = avg([...mDiaL, ...mDiaR, ...eDiaL, ...eDiaR]);
  const map = (avgSysAll != null && avgDiaAll != null)
    ? Math.round((avgSysAll + 2 * avgDiaAll) / 3) : null;
  const mapLabel = map == null ? '—'
    : map < 70 ? 'Знижений' : map <= 100 ? 'Норма'
    : map <= 110 ? 'Підвищений' : 'Значно підвищений';

  // Min/Max single reading (by systolic)
  const allReadings = [];
  filtered.forEach(e => {
    const dl = fmtDateUk(String(e.date).slice(0,10));
    if (e.m_sys_l != null && e.m_dia_l != null)
      allReadings.push({ sys: e.m_sys_l, dia: e.m_dia_l, pulse: e.m_pulse_l ?? e.m_pulse, date: dl, label: 'ранок Л' });
    if (e.m_sys_r != null && e.m_dia_r != null)
      allReadings.push({ sys: e.m_sys_r, dia: e.m_dia_r, pulse: e.m_pulse_r ?? e.m_pulse, date: dl, label: 'ранок П' });
    if (e.e_sys_l != null && e.e_dia_l != null)
      allReadings.push({ sys: e.e_sys_l, dia: e.e_dia_l, pulse: e.e_pulse_l ?? e.e_pulse, date: dl, label: 'вечір Л' });
    if (e.e_sys_r != null && e.e_dia_r != null)
      allReadings.push({ sys: e.e_sys_r, dia: e.e_dia_r, pulse: e.e_pulse_r ?? e.e_pulse, date: dl, label: 'вечір П' });
  });
  const maxR = allReadings.length ? allReadings.reduce((a, b) => b.sys > a.sys ? b : a) : null;
  const minR = allReadings.length ? allReadings.reduce((a, b) => b.sys < a.sys ? b : a) : null;
  function readingStr(r) {
    if (!r) return '—';
    return `${r.sys}/${r.dia} мм${r.pulse != null ? ', пульс ' + r.pulse : ''} — ${r.date} (${r.label})`;
  }

  // Arm difference count
  let armDiffCount = 0, armTotal = 0;
  filtered.forEach(e => {
    if (e.m_sys_l != null && e.m_sys_r != null) {
      armTotal++;
      if (Math.abs(e.m_sys_l - e.m_sys_r) > 10) armDiffCount++;
    }
    if (e.e_sys_l != null && e.e_sys_r != null) {
      armTotal++;
      if (Math.abs(e.e_sys_l - e.e_sys_r) > 10) armDiffCount++;
    }
  });

  // Daily index
  const avgMSys = avg(mSysL.map((v, i) => v ?? mSysR[i]));
  const avgESys = avg(eSysL.map((v, i) => v ?? eSysR[i]));
  const dailyIndex = (avgMSys != null && avgESys != null && avgMSys > 0)
    ? Math.round((avgMSys - avgESys) / avgMSys * 100 * 10) / 10 : null;

  // Trends
  const avgSysArr = filtered.map(e => {
    const v = [e.m_sys_l, e.m_sys_r, e.e_sys_l, e.e_sys_r].filter(x => x != null);
    return v.length ? Math.round(v.reduce((a,b) => a+b,0) / v.length) : null;
  });
  const avgDiaArr = filtered.map(e => {
    const v = [e.m_dia_l, e.m_dia_r, e.e_dia_l, e.e_dia_r].filter(x => x != null);
    return v.length ? Math.round(v.reduce((a,b) => a+b,0) / v.length) : null;
  });
  const pulseArr = filtered.map(e => {
    const v = [e.m_pulse, e.e_pulse].filter(x => x != null);
    return v.length ? Math.round(v.reduce((a,b) => a+b,0) / v.length) : null;
  });

  // Correlations
  const sysByDay = filtered.map(e => e.m_sys_l ?? e.m_sys_r);
  const rSysWeight = pearsonR(sysByDay, weights);
  const rPulseSys  = pearsonR(mPulse, sysByDay);
  const rMornEve   = pearsonR(sysByDay, filtered.map(e => e.e_sys_l ?? e.e_sys_r));
  const rDiaWeight = pearsonR(filtered.map(e => e.m_dia_l ?? e.m_dia_r), weights);

  function sr(label, value) {
    return `<tr><td class="stat-label">${label}</td><td class="stat-val">${value ?? '—'}</td></tr>`;
  }

  const statsSection = (mode === 'extended' && filtered.length >= 3) ? `

  <div class="section-title">📊 Загальна статистика (WHO/ESH 2023)</div>
  <div class="stats-grid">
    <div class="stats-block">
      <div class="stats-block-title">Артеріальний тиск</div>
      <table class="stats-table">
        ${sr('WHO/ESH 2023 категорія', bpCategoryLabel(avgSysAll, avgDiaAll))}
        ${sr('MAP — середній артер. тиск', map != null ? map + ' мм рт.ст. (' + mapLabel + ')' : '—')}
        ${sr('Максимальний вимір (Сист.)', readingStr(maxR))}
        ${sr('Мінімальний вимір (Сист.)', readingStr(minR))}
        ${sr('Різниця рук >10 мм', armTotal ? armDiffCount + ' з ' + armTotal + ' вимірів' : '—')}
      </table>
    </div>
    <div class="stats-block">
      <div class="stats-block-title">Пульс та вага</div>
      <table class="stats-table">
        ${sr('Серед. пульс ранок', avg(mPulse) != null ? avg(mPulse) + ' уд/хв' : '—')}
        ${sr('Серед. пульс вечір', avg(ePulse) != null ? avg(ePulse) + ' уд/хв' : '—')}
        ${sr('Мін/Макс пульс', (() => { const m = minMax([...mPulse, ...ePulse]); return m ? m.min + ' / ' + m.max + ' уд/хв' : '—'; })())}
        ${sr('Середня вага', avg(weights) != null ? avg(weights) + ' кг' : '—')}
        ${sr('Мін/Макс вага', (() => { const m = minMax(weights); return m ? m.min + ' / ' + m.max + ' кг' : '—'; })())}
      </table>
    </div>
  </div>

  <div class="section-title">📐 Детальна статистика по руках</div>
  <div class="stats-grid stats-grid-4">
    <div class="stats-block">
      <div class="stats-block-title">Ранок — ліва рука</div>
      <table class="stats-table">
        ${sr('Серед. Сист/Діаст', avg(mSysL) != null ? avg(mSysL)+'/'+avg(mDiaL) : '—')}
        ${sr('Медіана Сист/Діаст', median(mSysL) != null ? median(mSysL)+'/'+median(mDiaL) : '—')}
        ${sr('Ст. відхилення Сист.', stdDev(mSysL))}
      </table>
    </div>
    <div class="stats-block">
      <div class="stats-block-title">Ранок — права рука</div>
      <table class="stats-table">
        ${sr('Серед. Сист/Діаст', avg(mSysR) != null ? avg(mSysR)+'/'+avg(mDiaR) : '—')}
        ${sr('Медіана Сист/Діаст', median(mSysR) != null ? median(mSysR)+'/'+median(mDiaR) : '—')}
        ${sr('Ст. відхилення Сист.', stdDev(mSysR))}
      </table>
    </div>
    <div class="stats-block">
      <div class="stats-block-title">Вечір — ліва рука</div>
      <table class="stats-table">
        ${sr('Серед. Сист/Діаст', avg(eSysL) != null ? avg(eSysL)+'/'+avg(eDiaL) : '—')}
        ${sr('Медіана Сист/Діаст', median(eSysL) != null ? median(eSysL)+'/'+median(eDiaL) : '—')}
        ${sr('Ст. відхилення Сист.', stdDev(eSysL))}
      </table>
    </div>
    <div class="stats-block">
      <div class="stats-block-title">Вечір — права рука</div>
      <table class="stats-table">
        ${sr('Серед. Сист/Діаст', avg(eSysR) != null ? avg(eSysR)+'/'+avg(eDiaR) : '—')}
        ${sr('Медіана Сист/Діаст', median(eSysR) != null ? median(eSysR)+'/'+median(eDiaR) : '—')}
        ${sr('Ст. відхилення Сист.', stdDev(eSysR))}
      </table>
    </div>
  </div>

  <div class="section-title">📈 Тренди та кореляційний аналіз</div>
  <div class="stats-grid">
    <div class="stats-block">
      <div class="stats-block-title">Тренди за період (лінійна регресія)</div>
      <table class="stats-table">
        ${sr('Систолічний тиск', trendStr(avgSysArr, 2, 0) + (trendStr(avgSysArr,2,0) !== '—' && trendStr(avgSysArr,2,0) !== 'без змін' ? ' мм' : ''))}
        ${sr('Діастолічний тиск', trendStr(avgDiaArr, 2, 0) + (trendStr(avgDiaArr,2,0) !== '—' && trendStr(avgDiaArr,2,0) !== 'без змін' ? ' мм' : ''))}
        ${sr('Пульс', trendStr(pulseArr, 2, 0) + (trendStr(pulseArr,2,0) !== '—' && trendStr(pulseArr,2,0) !== 'без змін' ? ' уд/хв' : ''))}
        ${sr('Вага', trendStr(weights, 0.3, 1) + (trendStr(weights,0.3,1) !== '—' && trendStr(weights,0.3,1) !== 'без змін' ? ' кг' : ''))}
        ${sr('Денний індекс (ранок−вечір)/ранок', dailyIndex != null ? dailyIndex + ' %' : '—')}
      </table>
    </div>
    <div class="stats-block">
      <div class="stats-block-title">Кореляційний аналіз (r Пірсона)</div>
      <table class="stats-table">
        ${sr('Систолічний тиск ↔ Вага', corrLabel(rSysWeight))}
        ${sr('Діастолічний тиск ↔ Вага', corrLabel(rDiaWeight))}
        ${sr('Пульс ↔ Систолічний тиск', corrLabel(rPulseSys))}
        ${sr('Ранок ↔ Вечір (Сист.)', corrLabel(rMornEve))}
      </table>
    </div>
  </div>` : '';

  // ── Lab results section (extended only) ───────────────────────────────────
  const sex = user.sex || null;
  const labsSorted = labs.slice().sort((a, b) =>
    String(a.date).slice(0, 10).localeCompare(String(b.date).slice(0, 10)));
  const labsInPeriod = labsSorted.filter(l => {
    const d = String(l.date).slice(0, 10);
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  });
  const labsShown = labsInPeriod.length ? labsInPeriod
    : (labsSorted.length ? [labsSorted[labsSorted.length - 1]] : []);
  const latestLab = labsShown.length ? labsShown[labsShown.length - 1] : null;
  const outOfPeriodNote = (!labsInPeriod.length && latestLab) ? ' (останній доступний, поза періодом)' : '';

  const labRows = labsShown.map(l => {
    const t = labNum(l.total_chol), h = labNum(l.hdl);
    const nonHdl = (t != null && h != null) ? +(t - h).toFixed(2) : null;
    return `<tr>
      <td>${fmtDateUk(String(l.date).slice(0,10))}</td>
      ${labCell('hba1c', labNum(l.hba1c), sex)}
      ${labCell('total_chol', t, sex)}
      ${labCell('hdl', h, sex)}
      ${labCell('ldl', labNum(l.ldl), sex)}
      ${labCell('triglycerides', labNum(l.triglycerides), sex)}
      ${labCell('nonhdl', nonHdl, sex)}
    </tr>`;
  }).join('');

  let labEvalBlock = '';
  if (latestLab) {
    const t = labNum(latestLab.total_chol), h = labNum(latestLab.hdl);
    const ldl = labNum(latestLab.ldl), tg = labNum(latestLab.triglycerides), a1c = labNum(latestLab.hba1c);
    const nonHdl = (t != null && h != null) ? +(t - h).toFixed(2) : null;
    const nonHdlNote = nonHdl == null ? '—'
      : nonHdl + ' ммоль/л (' + (nonHdl < 2.2 ? 'ціль ✓' : nonHdl < 3.4 ? 'близько до цілі' : 'вище цілі') + ', ціль <2.2)';
    labEvalBlock = `
  <div class="stats-grid">
    <div class="stats-block">
      <div class="stats-block-title">Оцінка останнього аналізу (${fmtDateUk(String(latestLab.date).slice(0,10))}) — цілі ESC, дуже високий ризик</div>
      <table class="stats-table">
        ${sr('HbA1c', a1c != null ? fmtLab(a1c) + ' % (' + labEvalText('hba1c', a1c, sex) + ')' : '—')}
        ${sr('ЛПНЩ (LDL)', ldl != null ? fmtLab(ldl) + ' ммоль/л (' + labEvalText('ldl', ldl, sex) + ', ціль <1.4)' : '—')}
        ${sr('non-HDL (розрах.)', nonHdlNote)}
        ${sr('Тригліцериди', tg != null ? fmtLab(tg) + ' ммоль/л (' + labEvalText('triglycerides', tg, sex) + ')' : '—')}
      </table>
    </div>
  </div>`;
  }

  const labSection = (mode === 'extended' && labsShown.length) ? `
  <div class="section-title">🧪 Лабораторні показники${outOfPeriodNote}</div>
  <table class="data">
    <thead>
      <tr>
        <th>Дата</th>
        <th>HbA1c<br/>%</th>
        <th>Загальний<br/>ммоль/л</th>
        <th>ЛПВЩ<br/>ммоль/л</th>
        <th>ЛПНЩ<br/>ммоль/л</th>
        <th>Тригліц.<br/>ммоль/л</th>
        <th>non-HDL<br/>ммоль/л</th>
      </tr>
    </thead>
    <tbody>${labRows}</tbody>
  </table>
  ${labEvalBlock}` : '';

  // ── Period overview panel (extended only) ─────────────────────────────────
  const overviewPanel = (mode === 'extended' && filtered.length) ? (() => {
    const tally = { good: 0, warning: 0, serious: 0, critical: 0, none: 0 };
    filtered.forEach(e => { tally[dayWorstStatus(e) || 'none']++; });
    const tile = (label, n, st) => {
      const s = BP_STATUS_STYLE[st];
      return `<div class="glance-tile" style="background:${s.bg};color:${s.fg}">
        <div class="glance-num">${n}</div><div class="glance-lbl">${label}</div></div>`;
    };
    return `
  <div class="section-title">🩺 Огляд періоду (за найгіршим виміром дня)</div>
  <div class="glance-grid">
    ${tile('у нормі', tally.good, 'good')}
    ${tile('погранично', tally.warning, 'warning')}
    ${tile('підвищений', tally.serious, 'serious')}
    ${tile('критичний', tally.critical, 'critical')}
  </div>`;
  })() : '';

  // ── Colour legend (both modes) ────────────────────────────────────────────
  const legend = `
  <div class="legend">
    <span class="legend-title">Позначення:</span>
    <span class="chip" style="background:#e6f5e6;color:#0a7d0a">Оптим. / Норм.</span>
    <span class="chip" style="background:#fdf3d9;color:#8a6100">⚠ Вис. норм. / АГ 1 ст.</span>
    <span class="chip" style="background:#fbe6db;color:#a8481a">⚠ Ізол. АГ / АГ 2 ст.</span>
    <span class="chip" style="background:#f8dada;color:#a81f1f">‼ АГ 3 ст.</span>
    <span class="legend-plain">⚖️ різниця рук &gt;10 мм</span>
    <span class="legend-plain">пульс ↓ &lt;60 / ↑ &gt;100</span>
  </div>`;

  const notesColspan = hasNotes ? 9 : 8;

  return `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Noto Sans', Arial, sans-serif; font-size: 11px; color: #111; background: #fff; padding: 20mm 15mm; }

    .report-header { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; border-bottom: 2px solid #333; padding-bottom: 14px; }
    .report-header-text { flex: 1; text-align: center; }
    .report-title { font-size: 18px; font-weight: 700; letter-spacing: 1px; }
    .report-subtitle { font-size: 11px; color: #666; margin-top: 3px; }

    .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    .meta-table td { padding: 4px 8px; font-size: 11px; }
    .meta-table td:first-child { font-weight: 600; color: #555; width: 180px; }

    table.data { width: 100%; border-collapse: collapse; margin-top: 10px; page-break-inside: auto; }
    table.data thead { display: table-header-group; }
    table.data th { background: #1a2744; color: #fff; padding: 6px 5px; font-size: 10px; font-weight: 600; text-align: center; border: 1px solid #0d1a33; }
    table.data td { padding: 5px 5px; text-align: center; border: 1px solid #ccc; font-size: 10.5px; }
    table.data tr:nth-child(even) td { background: #f5f7fb; }
    table.data tr.avg-row td { background: #e8f0fe; border-top: 2px solid #333; font-weight: 600; }
    .group-header { background: #2a3f6f !important; color: #fff !important; font-size: 10px; font-weight: 600; }

    .section-title { font-size: 13px; font-weight: 700; color: #1a2744; margin: 20px 0 10px 0; padding-bottom: 5px; border-bottom: 1px solid #ccc; }

    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .stats-grid-4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
    .stats-block { border: 1px solid #ddd; border-radius: 4px; overflow: hidden; }
    .stats-block-title { background: #2a3f6f; color: #fff; font-size: 9.5px; font-weight: 600; padding: 5px 8px; }
    .stats-table { width: 100%; border-collapse: collapse; }
    .stats-table tr:nth-child(even) td { background: #f5f7fb; }
    .stats-table td { padding: 4px 8px; font-size: 10px; border-bottom: 1px solid #eee; }
    td.stat-label { color: #444; width: 65%; }
    td.stat-val { font-weight: 600; color: #1a2744; text-align: right; }

    .footer { margin-top: 20px; font-size: 10px; color: #888; text-align: right; border-top: 1px solid #ddd; padding-top: 8px; }

    .legend { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 9px; color: #444; border-top: 1px solid #ddd; padding-top: 8px; }
    .legend-title { font-weight: 700; color: #333; }
    .legend .chip { padding: 1px 6px; border-radius: 8px; font-weight: 600; }
    .legend-plain { padding: 1px 4px; }

    .glance-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 4px; }
    .glance-tile { border: 1px solid #0001; border-radius: 6px; padding: 8px 6px; text-align: center; }
    .glance-num { font-size: 22px; font-weight: 700; line-height: 1.1; }
    .glance-lbl { font-size: 9px; margin-top: 2px; }

    @media print {
      body { padding: 10mm; }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
      .stats-grid, .stats-grid-4 { page-break-inside: avoid; }
      .glance-grid { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    ${LOGO_SVG}
    <div class="report-header-text">
      <div class="report-title">ЖУРНАЛ АРТЕРІАЛЬНОГО ТИСКУ</div>
      <div class="report-subtitle">BP &amp; BMI — ${mode === 'extended' ? 'Розширений звіт з аналітикою' : 'Таблиця показників для лікаря'}</div>
    </div>
  </div>

  <table class="meta-table">
    <tr><td>Пацієнт:</td><td>${escHtml(user.name)}</td></tr>
    <tr><td>Дата народження:</td><td>${dob}${age !== '—' ? ' &nbsp;(' + age + ')' : ''}</td></tr>
    <tr><td>Період:</td><td>${fmtDateUk(dateFrom)} — ${fmtDateUk(dateTo)}</td></tr>
    <tr><td>Сформовано:</td><td>${today}</td></tr>
    <tr><td>Всього записів:</td><td>${filtered.length}</td></tr>
  </table>

  ${overviewPanel}

  <table class="data">
    <thead>
      <tr>
        <th rowspan="2">Дата</th>
        <th colspan="3" class="group-header">🌅 Ранок</th>
        <th colspan="3" class="group-header">🌙 Вечір</th>
        <th rowspan="2">Вага<br/>кг</th>
        ${hasNotes ? '<th rowspan="2" style="min-width:70px">Нотатки</th>' : ''}
      </tr>
      <tr>
        <th>Ліва рука<br/>Сист/Діаст</th>
        <th>Права рука<br/>Сист/Діаст</th>
        <th>Пульс</th>
        <th>Ліва рука<br/>Сист/Діаст</th>
        <th>Права рука<br/>Сист/Діаст</th>
        <th>Пульс</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="${notesColspan}" style="text-align:center;padding:20px;color:#888">Немає даних за вказаний період</td></tr>`}
      ${filtered.length > 0 ? avgRow : ''}
    </tbody>
  </table>

  ${statsSection}

  ${labSection}

  ${legend}

  <div class="footer">
    Документ сформовано автоматично системою моніторингу здоров'я &bull; ${today} &bull; WHO/ESH 2023
  </div>
</body>
</html>`;
}

async function generatePdf(user, entries, labs, dateFrom, dateTo, mode = 'short') {
  const html = buildHtml(user, entries, labs, dateFrom, dateTo, mode);
  const launchOptions = {
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    timeout: 15000,
  };
  // Use an explicit system Chromium ONLY when CHROMIUM_PATH is set (e.g. arm64 /
  // Raspberry Pi, where Puppeteer has no bundled build). Otherwise fall back to
  // Puppeteer's own managed Chromium — portable across servers and free of the
  // snap-confinement issues that break the snap `chromium`.
  const cp = (process.env.CHROMIUM_PATH || '').trim();
  if (cp) launchOptions.executablePath = cp;
  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<div style="font-size:9px;color:#888;width:100%;text-align:center;padding:0 10mm"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
      timeout: 30000,
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

module.exports = { generatePdf };
