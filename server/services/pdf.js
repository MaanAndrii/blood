const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

function escHtml(s) {
  if (s == null) return '—';
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
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}.${month}.${year}`;
}

function fmtVal(v) {
  return v != null ? String(v) : '—';
}

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
  return nums.length % 2 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2 * 10) / 10;
}

function stdDev(values) {
  const nums = values.filter(v => v != null).map(Number);
  if (nums.length < 2) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return Math.round(Math.sqrt(variance) * 10) / 10;
}

function minMax(values) {
  const nums = values.filter(v => v != null).map(Number);
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
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

function corrLabel(r) {
  if (r === null) return '—';
  const abs = Math.abs(r);
  const strength = abs >= 0.7 ? 'сильна' : abs >= 0.4 ? 'помірна' : abs >= 0.2 ? 'слабка' : 'відсутня';
  const dir = r > 0 ? '↑' : '↓';
  return `${r} (${dir} ${strength})`;
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

const _iconPath = path.join(__dirname, '..', '..', 'client', 'icons', 'icon-192.svg');
const _iconSvgRaw = fs.readFileSync(_iconPath, 'utf8');
// Strip XML declaration if present, set explicit size
const LOGO_SVG = _iconSvgRaw
  .replace(/<\?xml[^?]*\?>/, '')
  .replace(/<svg /, '<svg width="56" height="56" ');

function buildHtml(user, entries, dateFrom, dateTo) {
  const today = fmtDateUk(new Date().toISOString().slice(0, 10));
  const dob = user.date_of_birth ? fmtDateUk(user.date_of_birth) : '—';
  let age = '—';
  if (user.date_of_birth) {
    const birth = new Date(user.date_of_birth);
    const now = new Date();
    let years = now.getUTCFullYear() - birth.getUTCFullYear();
    const notYetBirthday =
      now.getUTCMonth() < birth.getUTCMonth() ||
      (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate());
    if (notYetBirthday) years--;
    age = years >= 0 ? String(years) + ' р.' : '—';
  }

  const filtered = entries.filter(e => {
    const d = String(e.date).slice(0, 10);
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  }).sort((a, b) => String(a.date).slice(0, 10).localeCompare(String(b.date).slice(0, 10)));

  const rows = filtered.map(e => {
    const dateStr = String(e.date).slice(0, 10);
    return `
      <tr>
        <td>${fmtDateUk(dateStr)}</td>
        <td>${bpStr(e.m_sys_l, e.m_dia_l)}</td>
        <td>${bpStr(e.m_sys_r, e.m_dia_r)}</td>
        <td>${fmtVal(e.m_pulse)}</td>
        <td>${bpStr(e.e_sys_l, e.e_dia_l)}</td>
        <td>${bpStr(e.e_sys_r, e.e_dia_r)}</td>
        <td>${fmtVal(e.e_pulse)}</td>
        <td>${e.weight != null ? parseFloat(e.weight).toFixed(1) : '—'}</td>
      </tr>`;
  }).join('');

  const avgRow = `
    <tr class="avg-row">
      <td><strong>Середнє</strong></td>
      <td>${avg(filtered.map(e => e.m_sys_l)) != null ? avg(filtered.map(e => e.m_sys_l)) + '/' + avg(filtered.map(e => e.m_dia_l)) : '—'}</td>
      <td>${avg(filtered.map(e => e.m_sys_r)) != null ? avg(filtered.map(e => e.m_sys_r)) + '/' + avg(filtered.map(e => e.m_dia_r)) : '—'}</td>
      <td>${avg(filtered.map(e => e.m_pulse)) ?? '—'}</td>
      <td>${avg(filtered.map(e => e.e_sys_l)) != null ? avg(filtered.map(e => e.e_sys_l)) + '/' + avg(filtered.map(e => e.e_dia_l)) : '—'}</td>
      <td>${avg(filtered.map(e => e.e_sys_r)) != null ? avg(filtered.map(e => e.e_sys_r)) + '/' + avg(filtered.map(e => e.e_dia_r)) : '—'}</td>
      <td>${avg(filtered.map(e => e.e_pulse)) ?? '—'}</td>
      <td>${avg(filtered.map(e => e.weight != null ? parseFloat(e.weight) : null)) ?? '—'}</td>
    </tr>`;

  // — Statistics —
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

  const avgMSys = avg(mSysL.map((v, i) => v ?? mSysR[i]));
  const avgESys = avg(eSysL.map((v, i) => v ?? eSysR[i]));
  const dailyIndex = (avgMSys != null && avgESys != null && avgMSys > 0)
    ? Math.round((avgMSys - avgESys) / avgMSys * 100 * 10) / 10
    : null;

  const avgSys = avg(mSysL) ?? avg(mSysR);
  const avgDia = avg(mDiaL) ?? avg(mDiaR);
  const avgCat = bpCategoryLabel(avgSys, avgDia);

  const sysByDay = filtered.map(e => e.m_sys_l ?? e.m_sys_r);
  const rSysWeight = pearsonR(sysByDay, weights);
  const rPulseSys  = pearsonR(mPulse, sysByDay);
  const rMornEve   = pearsonR(sysByDay, filtered.map(e => e.e_sys_l ?? e.e_sys_r));

  function sr(label, value) {
    return `<tr><td class="stat-label">${label}</td><td class="stat-val">${value ?? '—'}</td></tr>`;
  }

  const statsSection = filtered.length >= 3 ? `
  <div class="section-title">📊 Статистичний аналіз (WHO/ESH 2023)</div>
  <div class="stats-grid">
    <div class="stats-block">
      <div class="stats-block-title">Ранок — ліва рука</div>
      <table class="stats-table">
        ${sr('Серед. Сист/Діаст', avg(mSysL) != null ? avg(mSysL) + '/' + avg(mDiaL) : '—')}
        ${sr('Медіана Сист/Діаст', median(mSysL) != null ? median(mSysL) + '/' + median(mDiaL) : '—')}
        ${sr('Мін/Макс Сист.', (() => { const m = minMax(mSysL); return m ? m.min + ' / ' + m.max : '—'; })())}
        ${sr('Мін/Макс Діаст.', (() => { const m = minMax(mDiaL); return m ? m.min + ' / ' + m.max : '—'; })())}
        ${sr('Ст. відхилення Сист.', stdDev(mSysL))}
      </table>
    </div>
    <div class="stats-block">
      <div class="stats-block-title">Ранок — права рука</div>
      <table class="stats-table">
        ${sr('Серед. Сист/Діаст', avg(mSysR) != null ? avg(mSysR) + '/' + avg(mDiaR) : '—')}
        ${sr('Медіана Сист/Діаст', median(mSysR) != null ? median(mSysR) + '/' + median(mDiaR) : '—')}
        ${sr('Мін/Макс Сист.', (() => { const m = minMax(mSysR); return m ? m.min + ' / ' + m.max : '—'; })())}
        ${sr('Мін/Макс Діаст.', (() => { const m = minMax(mDiaR); return m ? m.min + ' / ' + m.max : '—'; })())}
        ${sr('Ст. відхилення Сист.', stdDev(mSysR))}
      </table>
    </div>
    <div class="stats-block">
      <div class="stats-block-title">Вечір — ліва рука</div>
      <table class="stats-table">
        ${sr('Серед. Сист/Діаст', avg(eSysL) != null ? avg(eSysL) + '/' + avg(eDiaL) : '—')}
        ${sr('Медіана Сист/Діаст', median(eSysL) != null ? median(eSysL) + '/' + median(eDiaL) : '—')}
        ${sr('Мін/Макс Сист.', (() => { const m = minMax(eSysL); return m ? m.min + ' / ' + m.max : '—'; })())}
        ${sr('Мін/Макс Діаст.', (() => { const m = minMax(eDiaL); return m ? m.min + ' / ' + m.max : '—'; })())}
        ${sr('Ст. відхилення Сист.', stdDev(eSysL))}
      </table>
    </div>
    <div class="stats-block">
      <div class="stats-block-title">Вечір — права рука</div>
      <table class="stats-table">
        ${sr('Серед. Сист/Діаст', avg(eSysR) != null ? avg(eSysR) + '/' + avg(eDiaR) : '—')}
        ${sr('Медіана Сист/Діаст', median(eSysR) != null ? median(eSysR) + '/' + median(eDiaR) : '—')}
        ${sr('Мін/Макс Сист.', (() => { const m = minMax(eSysR); return m ? m.min + ' / ' + m.max : '—'; })())}
        ${sr('Мін/Макс Діаст.', (() => { const m = minMax(eDiaR); return m ? m.min + ' / ' + m.max : '—'; })())}
        ${sr('Ст. відхилення Сист.', stdDev(eSysR))}
      </table>
    </div>
  </div>

  <div class="stats-grid" style="margin-top:8px">
    <div class="stats-block">
      <div class="stats-block-title">Денний індекс та пульс</div>
      <table class="stats-table">
        ${sr('Денний індекс (ранок−вечір/ранок)', dailyIndex != null ? dailyIndex + ' %' : '—')}
        ${sr('WHO/ESH 2023 — категорія (ранок)', avgCat)}
        ${sr('Серед. пульс ранок', avg(mPulse) != null ? avg(mPulse) + ' уд/хв' : '—')}
        ${sr('Серед. пульс вечір', avg(ePulse) != null ? avg(ePulse) + ' уд/хв' : '—')}
        ${sr('Мін/Макс пульс', (() => { const m = minMax([...mPulse, ...ePulse]); return m ? m.min + ' / ' + m.max + ' уд/хв' : '—'; })())}
      </table>
    </div>
    <div class="stats-block">
      <div class="stats-block-title">Кореляційний аналіз (r Пірсона)</div>
      <table class="stats-table">
        ${sr('Систолічний тиск ↔ Вага', corrLabel(rSysWeight))}
        ${sr('Пульс ↔ Систолічний тиск', corrLabel(rPulseSys))}
        ${sr('Ранок ↔ Вечір (Сист.)', corrLabel(rMornEve))}
      </table>
    </div>
  </div>` : '';

  return `<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="UTF-8" />
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Noto Sans', Arial, sans-serif;
      font-size: 11px;
      color: #111;
      background: #fff;
      padding: 20mm 15mm;
    }

    .report-header {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 20px;
      border-bottom: 2px solid #333;
      padding-bottom: 14px;
    }

    .report-header-text { flex: 1; text-align: center; }

    .report-title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 1px;
    }

    .report-subtitle {
      font-size: 11px;
      color: #666;
      margin-top: 3px;
    }

    .meta-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    .meta-table td {
      padding: 4px 8px;
      font-size: 11px;
    }
    .meta-table td:first-child {
      font-weight: 600;
      color: #555;
      width: 180px;
    }

    table.data {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      page-break-inside: auto;
    }

    table.data thead { display: table-header-group; }

    table.data th {
      background: #1a2744;
      color: #fff;
      padding: 6px 5px;
      font-size: 10px;
      font-weight: 600;
      text-align: center;
      border: 1px solid #0d1a33;
    }

    table.data td {
      padding: 5px 5px;
      text-align: center;
      border: 1px solid #ccc;
      font-size: 10.5px;
    }

    table.data tr:nth-child(even) td { background: #f5f7fb; }

    table.data tr.avg-row td {
      background: #e8f0fe;
      border-top: 2px solid #333;
      font-weight: 600;
    }

    .group-header {
      background: #2a3f6f !important;
      color: #fff !important;
      font-size: 10px;
      font-weight: 600;
    }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      color: #1a2744;
      margin: 20px 0 10px 0;
      padding-bottom: 5px;
      border-bottom: 1px solid #ccc;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .stats-block {
      border: 1px solid #ddd;
      border-radius: 4px;
      overflow: hidden;
    }

    .stats-block-title {
      background: #2a3f6f;
      color: #fff;
      font-size: 9.5px;
      font-weight: 600;
      padding: 5px 8px;
    }

    .stats-table { width: 100%; border-collapse: collapse; }
    .stats-table tr:nth-child(even) td { background: #f5f7fb; }
    .stats-table td { padding: 4px 8px; font-size: 10px; border-bottom: 1px solid #eee; }
    td.stat-label { color: #444; width: 65%; }
    td.stat-val { font-weight: 600; color: #1a2744; text-align: right; }

    .footer {
      margin-top: 20px;
      font-size: 10px;
      color: #888;
      text-align: right;
      border-top: 1px solid #ddd;
      padding-top: 8px;
    }

    @media print {
      body { padding: 10mm; }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
      .stats-grid { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    ${LOGO_SVG}
    <div class="report-header-text">
      <div class="report-title">ЖУРНАЛ АРТЕРІАЛЬНОГО ТИСКУ</div>
      <div class="report-subtitle">BP &amp; BMI — Система моніторингу здоров'я</div>
    </div>
  </div>

  <table class="meta-table">
    <tr><td>Пацієнт:</td><td>${escHtml(user.name)}</td></tr>
    <tr><td>Дата народження:</td><td>${dob}${age !== '—' ? ' &nbsp;(' + age + ')' : ''}</td></tr>
    <tr><td>Період:</td><td>${fmtDateUk(dateFrom)} — ${fmtDateUk(dateTo)}</td></tr>
    <tr><td>Сформовано:</td><td>${today}</td></tr>
    <tr><td>Всього записів:</td><td>${filtered.length}</td></tr>
  </table>

  <table class="data">
    <thead>
      <tr>
        <th rowspan="2">Дата</th>
        <th colspan="3" class="group-header">🌅 Ранок</th>
        <th colspan="3" class="group-header">🌙 Вечір</th>
        <th rowspan="2">Вага<br/>кг</th>
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
      ${rows || '<tr><td colspan="8" style="text-align:center;padding:20px;color:#888">Немає даних за вказаний період</td></tr>'}
      ${filtered.length > 0 ? avgRow : ''}
    </tbody>
  </table>

  ${statsSection}

  <div class="footer">
    Документ сформовано автоматично системою моніторингу здоров'я &bull; ${today} &bull; WHO/ESH 2023
  </div>
</body>
</html>`;
}

async function generatePdf(user, entries, dateFrom, dateTo) {
  const html = buildHtml(user, entries, dateFrom, dateTo);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' },
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-size:9px;color:#888;width:100%;text-align:center;padding:0 10mm">
          <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>`,
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

module.exports = { generatePdf };
