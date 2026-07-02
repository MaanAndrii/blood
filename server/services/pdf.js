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

// ── "Annotated" report mode: status/badge classification ───────────────────
// Maps WHO/ESH category labels (from bpCategoryLabel) onto a 4-level status
// scale used for color coding + a short print-safe text code.
const BP_STATUS_BY_CATEGORY = {
  'Оптимальний':       { status: 'good',     code: 'ОПТ'  },
  'Нормальний':        { status: 'good',     code: 'НОРМ' },
  'Висок. нормальний': { status: 'warning',  code: 'ВН'   },
  'Гіпертензія 1 ст.':  { status: 'warning',  code: 'Г1'   },
  'Ізол. сист. АГ':     { status: 'serious',  code: 'ІСАГ' },
  'Ізол. діаст. АГ':    { status: 'serious',  code: 'ІДАГ' },
  'Гіпертензія 2 ст.':  { status: 'serious',  code: 'Г2'   },
  'Гіпертензія 3 ст.':  { status: 'critical', code: 'Г3'   },
};
const STATUS_RANK = { good: 0, warning: 1, serious: 2, critical: 3 };
const ARM_DIFF_THRESHOLD = 10;

function bpStatus(sys, dia) {
  if (sys == null || dia == null) return null;
  return BP_STATUS_BY_CATEGORY[bpCategoryLabel(sys, dia)] || null;
}

function pulseStatus(p) {
  if (p == null) return null;
  const n = Number(p);
  if (n < 50 || n > 120) return { status: 'serious', code: n < 50 ? 'БРАД' : 'ТАХІ' };
  if (n < 60 || n > 100) return { status: 'warning', code: n < 60 ? 'БРАД' : 'ТАХІ' };
  return null;
}

function armDiffVal(sysL, sysR) {
  return (sysL != null && sysR != null) ? Math.abs(sysL - sysR) : null;
}

// BP reading cell: value + colored wrapper/badge if elevated and/or arm-diff flagged
function bpCellA(sys, dia, diff) {
  if (sys == null && dia == null) return '—';
  const val = `${sys}/${dia}`;
  const info = bpStatus(sys, dia);
  const bpFlag = info && info.status !== 'good';
  const diffFlag = diff != null && diff > ARM_DIFF_THRESHOLD;
  if (!bpFlag && !diffFlag) return val;
  const wrapStatus = bpFlag ? info.status : 'diff';
  let html = `<span class="bp-val bp-${wrapStatus}">${val}`;
  if (bpFlag) html += `<span class="bp-tag bp-tag-${info.status}">${info.code}</span>`;
  if (diffFlag) html += `<span class="bp-tag bp-tag-diff">Δ${diff}</span>`;
  html += `</span>`;
  return html;
}

function pulseCellA(p) {
  if (p == null) return '—';
  const info = pulseStatus(p);
  if (!info) return String(p);
  return `<span class="bp-val bp-${info.status}">${p}<span class="bp-tag bp-tag-${info.status}">${info.code}</span></span>`;
}

const _iconPath = path.join(__dirname, '..', '..', 'client', 'icons', 'icon-192.svg');
const _iconSvgRaw = fs.readFileSync(_iconPath, 'utf8');
const LOGO_SVG = _iconSvgRaw
  .replace(/<\?xml[^?]*\?>/, '')
  .replace(/<svg /, '<svg width="56" height="56" ');

function buildHtml(user, entries, dateFrom, dateTo, mode = 'short') {
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
      <td>${fmtDateUk(String(e.date).slice(0,10))}</td>
      <td>${bpStr(e.m_sys_l, e.m_dia_l)}</td>
      <td>${bpStr(e.m_sys_r, e.m_dia_r)}</td>
      <td>${fmtVal(e.m_pulse)}</td>
      <td>${bpStr(e.e_sys_l, e.e_dia_l)}</td>
      <td>${bpStr(e.e_sys_r, e.e_dia_r)}</td>
      <td>${fmtVal(e.e_pulse)}</td>
      <td>${e.weight != null ? parseFloat(e.weight).toFixed(1) : '—'}</td>
      ${hasNotes ? `<td style="text-align:left;font-size:9px">${escHtml(e.notes) || ''}</td>` : ''}
    </tr>`).join('');

  // "Annotated" mode: same columns, cells colored/badged by WHO/ESH status,
  // arm-difference and pulse anomalies flagged inline (see bpCellA/pulseCellA).
  const rowsAnnotated = filtered.map(e => {
    const mDiff = armDiffVal(e.m_sys_l, e.m_sys_r);
    const eDiff = armDiffVal(e.e_sys_l, e.e_sys_r);
    return `
    <tr>
      <td>${fmtDateUk(String(e.date).slice(0,10))}</td>
      <td>${bpCellA(e.m_sys_l, e.m_dia_l, null)}</td>
      <td>${bpCellA(e.m_sys_r, e.m_dia_r, mDiff)}</td>
      <td>${pulseCellA(e.m_pulse)}</td>
      <td>${bpCellA(e.e_sys_l, e.e_dia_l, null)}</td>
      <td>${bpCellA(e.e_sys_r, e.e_dia_r, eDiff)}</td>
      <td>${pulseCellA(e.e_pulse)}</td>
      <td>${e.weight != null ? parseFloat(e.weight).toFixed(1) : '—'}</td>
      ${hasNotes ? `<td style="text-align:left;font-size:9px">${escHtml(e.notes) || ''}</td>` : ''}
    </tr>`;
  }).join('');

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

  // Per-day worst status (for the "annotated" mode summary panel)
  let dayGoodCount = 0, dayWarningCount = 0, daySeriousCount = 0, dayCriticalCount = 0;
  filtered.forEach(e => {
    const readings = [
      bpStatus(e.m_sys_l, e.m_dia_l), bpStatus(e.m_sys_r, e.m_dia_r),
      bpStatus(e.e_sys_l, e.e_dia_l), bpStatus(e.e_sys_r, e.e_dia_r),
    ].filter(Boolean);
    if (!readings.length) return;
    const worst = readings.reduce((a, b) => STATUS_RANK[b.status] > STATUS_RANK[a.status] ? b : a);
    if (worst.status === 'good') dayGoodCount++;
    else if (worst.status === 'warning') dayWarningCount++;
    else if (worst.status === 'serious') daySeriousCount++;
    else dayCriticalCount++;
  });
  const pulseAnomalyCount = [...mPulse, ...ePulse].filter(p => pulseStatus(p) != null).length;

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

  const notesColspan = hasNotes ? 9 : 8;

  const summaryPanel = mode === 'annotated' ? `
  <div class="summary-panel">
    <div class="summary-item summary-good"><span class="summary-num">${dayGoodCount}</span><span class="summary-label">днів у нормі</span></div>
    <div class="summary-item summary-warning"><span class="summary-num">${dayWarningCount}</span><span class="summary-label">днів підвищений тиск</span></div>
    <div class="summary-item summary-serious"><span class="summary-num">${daySeriousCount}</span><span class="summary-label">днів значно підвищений</span></div>
    <div class="summary-item summary-critical"><span class="summary-num">${dayCriticalCount}</span><span class="summary-label">днів критичний</span></div>
    <div class="summary-item summary-diff"><span class="summary-num">${armDiffCount}</span><span class="summary-label">вимірів з різницею рук &gt;10 мм</span></div>
    <div class="summary-item summary-pulse"><span class="summary-num">${pulseAnomalyCount}</span><span class="summary-label">вимірів пульсу поза нормою</span></div>
  </div>` : '';

  const legendSection = mode === 'annotated' ? `
  <div class="section-title">🔎 Розшифровка позначень</div>
  <div class="legend-grid">
    <div class="legend-item"><span class="legend-swatch sw-good"></span>Без кольору — оптимальний/нормальний тиск</div>
    <div class="legend-item"><span class="legend-swatch sw-warning"></span>ВН / Г1 — високий нормальний / гіпертензія 1 ст.</div>
    <div class="legend-item"><span class="legend-swatch sw-serious"></span>ІСАГ / ІДАГ / Г2 — ізольована АГ / гіпертензія 2 ст.</div>
    <div class="legend-item"><span class="legend-swatch sw-critical"></span>Г3 — гіпертензія 3 ст. (потребує уваги лікаря)</div>
    <div class="legend-item"><span class="legend-swatch sw-diff"></span>Δ — різниця систолічного тиску між руками &gt;10 мм рт.ст.</div>
    <div class="legend-item"><span class="legend-swatch sw-warning"></span>БРАД / ТАХІ (жовтий) — пульс 50–59 або 101–120 уд/хв</div>
    <div class="legend-item"><span class="legend-swatch sw-serious"></span>БРАД / ТАХІ (оранжевий) — пульс &lt;50 або &gt;120 уд/хв</div>
  </div>
  <div class="legend-note">Класифікація за WHO/ESH 2023. Кожна позначка кольору дублюється текстовим кодом — коректно читається і при чорно-білому друку.</div>` : '';

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

    /* ── Annotated mode: status badges + summary panel + legend ── */
    .bp-val { display: inline-flex; align-items: center; gap: 3px; padding: 1px 4px; border-radius: 3px; white-space: nowrap; }
    .bp-warning  { background: #fab21930; border-left: 2px solid #fab219; }
    .bp-serious  { background: #ec835a30; border-left: 2px solid #ec835a; }
    .bp-critical { background: #d03b3b30; border-left: 2px solid #d03b3b; font-weight: 700; }
    .bp-diff     { background: #4a3aa730; border-left: 2px solid #4a3aa7; }
    .bp-tag { font-size: 7px; font-weight: 700; padding: 0 2px; border-radius: 2px; color: #fff; line-height: 1.4; }
    .bp-tag-warning  { background: #c98500; }
    .bp-tag-serious  { background: #ec835a; }
    .bp-tag-critical { background: #d03b3b; }
    .bp-tag-diff     { background: #4a3aa7; }

    .summary-panel { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 14px 0 18px; }
    .summary-item { border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; text-align: center; }
    .summary-item .summary-num { display: block; font-size: 20px; font-weight: 700; }
    .summary-item .summary-label { display: block; font-size: 8.5px; color: #666; margin-top: 2px; }
    .summary-good     .summary-num { color: #0ca30c; }
    .summary-warning  .summary-num { color: #c98500; }
    .summary-serious  .summary-num { color: #ec835a; }
    .summary-critical .summary-num { color: #d03b3b; }
    .summary-diff      .summary-num { color: #4a3aa7; }
    .summary-pulse      .summary-num { color: #1a2744; }

    .legend-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; font-size: 10px; margin-bottom: 8px; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .legend-swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0; }
    .sw-good     { background: #cde2fb; border: 1px solid #ccc; }
    .sw-warning  { background: #fab219; }
    .sw-serious  { background: #ec835a; }
    .sw-critical { background: #d03b3b; }
    .sw-diff     { background: #4a3aa7; }
    .legend-note { font-size: 9px; color: #888; font-style: italic; }

    @media print {
      body { padding: 10mm; }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
      .stats-grid, .stats-grid-4 { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    ${LOGO_SVG}
    <div class="report-header-text">
      <div class="report-title">ЖУРНАЛ АРТЕРІАЛЬНОГО ТИСКУ</div>
      <div class="report-subtitle">BP &amp; BMI — ${
        mode === 'extended' ? 'Розширений звіт з аналітикою'
        : mode === 'annotated' ? 'Кольоровий звіт з розшифровкою показників'
        : 'Таблиця показників для лікаря'
      }</div>
    </div>
  </div>

  <table class="meta-table">
    <tr><td>Пацієнт:</td><td>${escHtml(user.name)}</td></tr>
    <tr><td>Дата народження:</td><td>${dob}${age !== '—' ? ' &nbsp;(' + age + ')' : ''}</td></tr>
    <tr><td>Період:</td><td>${fmtDateUk(dateFrom)} — ${fmtDateUk(dateTo)}</td></tr>
    <tr><td>Сформовано:</td><td>${today}</td></tr>
    <tr><td>Всього записів:</td><td>${filtered.length}</td></tr>
  </table>

  ${summaryPanel}

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
      ${(mode === 'annotated' ? rowsAnnotated : rows) || `<tr><td colspan="${notesColspan}" style="text-align:center;padding:20px;color:#888">Немає даних за вказаний період</td></tr>`}
      ${filtered.length > 0 ? avgRow : ''}
    </tbody>
  </table>

  ${statsSection}

  ${legendSection}

  <div class="footer">
    Документ сформовано автоматично системою моніторингу здоров'я &bull; ${today} &bull; WHO/ESH 2023
  </div>
</body>
</html>`;
}

async function generatePdf(user, entries, dateFrom, dateTo, mode = 'short') {
  const html = buildHtml(user, entries, dateFrom, dateTo, mode);
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    timeout: 15000,
  });
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
