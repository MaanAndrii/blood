const puppeteer = require('puppeteer');

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

function buildHtml(user, entries, dateFrom, dateTo) {
  const today = fmtDateUk(new Date().toISOString().slice(0, 10));
  const dob = user.date_of_birth ? fmtDateUk(user.date_of_birth) : '—';

  // Filter entries by date range
  const filtered = entries.filter(e => {
    const d = e.date instanceof Date ? e.date.toISOString().slice(0, 10) : String(e.date).slice(0, 10);
    return (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
  }).sort((a, b) => {
    const da = a.date instanceof Date ? a.date.toISOString().slice(0, 10) : String(a.date).slice(0, 10);
    const db = b.date instanceof Date ? b.date.toISOString().slice(0, 10) : String(b.date).slice(0, 10);
    return da.localeCompare(db);
  });

  const rows = filtered.map(e => {
    const dateStr = e.date instanceof Date ? e.date.toISOString().slice(0, 10) : String(e.date).slice(0, 10);
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

  // Averages
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
      text-align: center;
      margin-bottom: 20px;
      border-bottom: 2px solid #333;
      padding-bottom: 14px;
    }

    .report-title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 1px;
      margin-bottom: 8px;
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

    table.data thead {
      display: table-header-group;
    }

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

    table.data tr:nth-child(even) td {
      background: #f5f7fb;
    }

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
    }
  </style>
</head>
<body>
  <div class="report-header">
    <div class="report-title">ЖУРНАЛ АРТЕРІАЛЬНОГО ТИСКУ</div>
  </div>

  <table class="meta-table">
    <tr><td>Пацієнт:</td><td>${user.name || '—'}</td></tr>
    <tr><td>Дата народження:</td><td>${dob}</td></tr>
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

  <div class="footer">
    Документ сформовано автоматично системою моніторингу здоров'я &bull; ${today}
  </div>
</body>
</html>`;
}

async function generatePdf(user, entries, dateFrom, dateTo) {
  const html = buildHtml(user, entries, dateFrom, dateTo);

  const browser = await puppeteer.launch({
    headless: 'new',
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
