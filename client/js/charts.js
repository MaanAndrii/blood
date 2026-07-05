// ── CHARTS ──────────────────────────────────────────────────────────────────
function setStatsFilter(el, val) {
  document.querySelectorAll('#page-stats .filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  statsFilter = val;
  renderCharts();
}

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: '#7a8fb5', font: { size: 10 }, maxRotation: 45 }, grid: { color: '#2a3f6f' } },
    y: { ticks: { color: '#7a8fb5', font: { size: 10 } }, grid: { color: '#2a3f6f' } }
  }
};

function buildChart(id, labels, datasets, extraOpts = {}) {
  if (charts[id]) charts[id].destroy();
  const ctx = document.getElementById(id).getContext('2d');
  charts[id] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: { ...chartDefaults, ...extraOpts }
  });
}

function renderInsights(data) {
  const el = document.getElementById('insightCardsBody');
  if (!el) return;
  if (!data.length) { el.innerHTML = '<p style="color:var(--muted);font-size:.85rem">Немає даних за обраний період</p>'; return; }

  function avg(arr) { const a = arr.filter(x => x != null); return a.length ? Math.round(a.reduce((s,x)=>s+x,0)/a.length) : null; }

  // 1. Average BP + WHO/ESH category
  const mSysAll = data.map(e => e.morning.sys_l ?? e.morning.sys_r);
  const mDiaAll = data.map(e => e.morning.dia_l ?? e.morning.dia_r);
  const aSys = avg(mSysAll), aDia = avg(mDiaAll);
  const cat = bpCategory(aSys, aDia);
  const bpLabel = (aSys != null && aDia != null) ? `${aSys}/${aDia}` : '—';
  const catLabel = cat ? cat.label : '—';
  const catColor = cat ? cat.color : 'var(--muted)';

  // 2. Morning vs evening systolic diff
  const avgMSys = avg(mSysAll);
  const eSysAll = data.map(e => e.evening.sys_l ?? e.evening.sys_r);
  const avgESys = avg(eSysAll);
  let mveLabel = '—', mveNote = '';
  if (avgMSys != null && avgESys != null) {
    const diff = avgMSys - avgESys;
    mveLabel = (diff >= 0 ? '+' : '') + diff + ' мм';
    mveNote = diff > 5 ? 'Ранок вищий — типово' : diff < -5 ? 'Вечір вищий — варто відстежити' : 'Ранок і вечір збігаються';
  }

  // 3. Arm difference >10mm
  const armDiffCount = data.reduce((n, e) => {
    const mDiff = (e.morning.sys_l != null && e.morning.sys_r != null) ? Math.abs(e.morning.sys_l - e.morning.sys_r) : null;
    const eDiff = (e.evening.sys_l != null && e.evening.sys_r != null) ? Math.abs(e.evening.sys_l - e.evening.sys_r) : null;
    return n + (mDiff != null && mDiff > 10 ? 1 : 0) + (eDiff != null && eDiff > 10 ? 1 : 0);
  }, 0);
  const totalMeasures = data.reduce((n, e) => {
    return n + (e.morning.sys_l != null && e.morning.sys_r != null ? 1 : 0)
             + (e.evening.sys_l != null && e.evening.sys_r != null ? 1 : 0);
  }, 0);
  const armLabel = totalMeasures ? `${armDiffCount} з ${totalMeasures}` : '—';
  const armIsWarn = armDiffCount > 2;
  const armNote = armDiffCount === 0 ? 'Різниця в межах норми' : armDiffCount <= 2 ? 'Кілька вимірів потребують уваги' : '⚠️ Порадьтеся з лікарем';

  // 4. Average pulse
  const allPulse = [...data.map(e => e.morning.pulse), ...data.map(e => e.evening.pulse)];
  const avgPulse = avg(allPulse);
  let pulseNote = '—';
  if (avgPulse != null) {
    pulseNote = avgPulse < 60 ? 'Брадикардія' : avgPulse > 100 ? 'Тахікардія' : 'Норма';
  }

  el.innerHTML = `
    <div class="insight-card">
      <div class="insight-label">Середній тиск (ранок)</div>
      <div class="insight-value" style="color:${catColor}">${bpLabel}</div>
      <div class="insight-note">${catLabel}</div>
    </div>
    <div class="insight-card">
      <div class="insight-label">Ранок vs Вечір (сист.)</div>
      <div class="insight-value">${mveLabel}</div>
      <div class="insight-note">${mveNote}</div>
    </div>
    <div class="insight-card" style="${armIsWarn ? 'border-color:#f97316;background:rgba(249,115,22,.1)' : ''}">
      <div class="insight-label">Різниця рук >10 мм</div>
      <div class="insight-value" style="${armIsWarn ? 'color:#f97316' : ''}">${armLabel}</div>
      <div class="insight-note" style="${armIsWarn ? 'color:#f97316;font-weight:600' : ''}">${armNote}</div>
    </div>
    <div class="insight-card">
      <div class="insight-label">Середній пульс</div>
      <div class="insight-value">${avgPulse != null ? avgPulse + ' уд/хв' : '—'}</div>
      <div class="insight-note">${pulseNote}</div>
    </div>
  `;
}

function renderCharts() {
  const data = filterEntries(statsFilter).slice().reverse();
  const labels = data.map(e => fmtDate(String(e.date).slice(0,10)));
  renderInsights(data);

  buildChart('chartSys', labels, [
    {
      label: 'Ранок Л', data: data.map(e => e.morning.sys_l),
      borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,.07)',
      borderWidth: 2, tension: .4, pointRadius: 3, pointBackgroundColor: '#fbbf24', fill: false
    },
    {
      label: 'Ранок П', data: data.map(e => e.morning.sys_r),
      borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,.07)',
      borderWidth: 2, tension: .4, pointRadius: 3, pointBackgroundColor: '#f97316', fill: false,
      borderDash: [4,3]
    },
    {
      label: 'Вечір Л', data: data.map(e => e.evening.sys_l),
      borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,.07)',
      borderWidth: 2, tension: .4, pointRadius: 3, pointBackgroundColor: '#818cf8', fill: false
    },
    {
      label: 'Вечір П', data: data.map(e => e.evening.sys_r),
      borderColor: '#a78bfa', backgroundColor: 'rgba(167,139,250,.07)',
      borderWidth: 2, tension: .4, pointRadius: 3, pointBackgroundColor: '#a78bfa', fill: false,
      borderDash: [4,3]
    }
  ], { plugins: { legend: { display: true, labels: { color: '#e8edf8', font: { size: 10 }, boxWidth: 20 } } } });

  buildChart('chartDia', labels, [
    {
      label: 'Ранок Л', data: data.map(e => e.morning.dia_l),
      borderColor: '#4f8ef7', backgroundColor: 'rgba(79,142,247,.07)',
      borderWidth: 2, tension: .4, pointRadius: 3, pointBackgroundColor: '#4f8ef7', fill: false
    },
    {
      label: 'Ранок П', data: data.map(e => e.morning.dia_r),
      borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,.07)',
      borderWidth: 2, tension: .4, pointRadius: 3, pointBackgroundColor: '#38bdf8', fill: false,
      borderDash: [4,3]
    },
    {
      label: 'Вечір Л', data: data.map(e => e.evening.dia_l),
      borderColor: '#c084fc', backgroundColor: 'rgba(192,132,252,.07)',
      borderWidth: 2, tension: .4, pointRadius: 3, pointBackgroundColor: '#c084fc', fill: false
    },
    {
      label: 'Вечір П', data: data.map(e => e.evening.dia_r),
      borderColor: '#e879f9', backgroundColor: 'rgba(232,121,249,.07)',
      borderWidth: 2, tension: .4, pointRadius: 3, pointBackgroundColor: '#e879f9', fill: false,
      borderDash: [4,3]
    }
  ], { plugins: { legend: { display: true, labels: { color: '#e8edf8', font: { size: 10 }, boxWidth: 20 } } } });

  buildChart('chartPulse', labels, [
    {
      label: 'Ранок Л', data: data.map(e => e.morning.pulse_l ?? e.morning.pulse),
      borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,.08)',
      borderWidth: 2, tension: .4, pointRadius: 3, pointBackgroundColor: '#34d399', fill: false
    },
    {
      label: 'Ранок П', data: data.map(e => e.morning.pulse_r ?? e.morning.pulse),
      borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,.04)',
      borderWidth: 2, tension: .4, pointRadius: 3, pointBackgroundColor: '#34d399', fill: false,
      borderDash: [4,3]
    },
    {
      label: 'Вечір Л', data: data.map(e => e.evening.pulse_l ?? e.evening.pulse),
      borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,.08)',
      borderWidth: 2, tension: .4, pointRadius: 3, pointBackgroundColor: '#818cf8', fill: false
    },
    {
      label: 'Вечір П', data: data.map(e => e.evening.pulse_r ?? e.evening.pulse),
      borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,.04)',
      borderWidth: 2, tension: .4, pointRadius: 3, pointBackgroundColor: '#818cf8', fill: false,
      borderDash: [4,3]
    }
  ], { plugins: { legend: { display: true, labels: { color: '#e8edf8', font: { size: 10 }, boxWidth: 20 } } } });

  const _h = currentUser?.height_cm;
  const _wMin = _h ? Math.round(18.5 * (_h/100)**2 * 10) / 10 : null;
  const _wMax = _h ? Math.round(24.9 * (_h/100)**2 * 10) / 10 : null;
  const _weightDatasets = [
    {
      label: 'Вага (кг)', data: data.map(e => e.weight),
      borderColor: '#f472b6', backgroundColor: 'rgba(244,114,182,.1)',
      borderWidth: 2, tension: .4, pointRadius: 4, pointBackgroundColor: '#f472b6', fill: true
    }
  ];
  if (_wMin !== null) {
    _weightDatasets.push({
      label: `Норма ІМТ (${_wMin}–${_wMax} кг)`,
      data: labels.map(() => _wMax),
      borderColor: 'rgba(34,197,94,.6)', borderWidth: 1.5, borderDash: [5, 4],
      pointRadius: 0, fill: '+1', backgroundColor: 'rgba(34,197,94,.1)',
    });
    _weightDatasets.push({
      label: '',
      data: labels.map(() => _wMin),
      borderColor: 'rgba(34,197,94,.6)', borderWidth: 1.5, borderDash: [5, 4],
      pointRadius: 0, fill: false,
    });
  }
  buildChart('chartWeight', labels, _weightDatasets, _wMin !== null ? {
    plugins: { legend: { display: true, labels: { color: '#e8edf8', font: { size: 10 }, boxWidth: 16,
      filter: item => item.text !== '' } } }
  } : {});

  // ── BMI card ─────────────────────────────────────────────────────────────
  (function renderBmiCard() {
    const el = document.getElementById('bmiCardBody');
    const h = currentUser?.height_cm;
    const lastWithWeight = entries.find(e => e.weight != null);
    const w = lastWithWeight?.weight != null ? parseFloat(lastWithWeight.weight) : null;
    const bmi = h && w ? calcBmi(w, h) : null;
    const cat = bmi ? bmiCategory(bmi) : null;

    const bmiRanges = [
      ['< 18.5', 'Дефіцит маси тіла',  '#60a5fa'],
      ['18.5–24.9', 'Норма',            '#22c55e'],
      ['25–29.9', 'Надлишкова вага',    '#eab308'],
      ['30–34.9', 'Ожиріння I ст.',     '#f97316'],
      ['35–39.9', 'Ожиріння II ст.',    '#ef4444'],
      ['≥ 40',    'Ожиріння III ст.',   '#b91c1c'],
    ];

    if (!h) {
      el.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:8px 0">
        Вкажіть <strong>зріст</strong> у профілі для розрахунку ІМТ.
      </div>`;
    } else if (!w) {
      el.innerHTML = `<div style="color:var(--muted);font-size:12px;padding:8px 0">
        Немає записів з вагою для розрахунку ІМТ.
      </div>`;
    } else {
      el.innerHTML = `
        <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;flex-wrap:wrap">
          <span style="font-size:36px;font-weight:700;font-family:var(--mono);color:${cat.color}">${bmi.toFixed(1)}</span>
          <div>
            <div style="font-size:14px;font-weight:600;color:${cat.color}">${cat.label}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">${cat.desc}</div>
          </div>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:10px">
          Зріст: ${h} см &nbsp;·&nbsp; Вага: ${w} кг &nbsp;·&nbsp; Середня за період: ${avgOf(data.map(e=>e.weight)) ?? '—'} кг &nbsp;·&nbsp; Рекомендована: ${_wMin ?? '—'}–${_wMax ?? '—'} кг
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          ${bmiRanges.map(([range, label, color]) => {
            const isCurrent = cat.label === label;
            return `<tr style="${isCurrent ? `background:color-mix(in srgb,${color} 18%,transparent)` : ''}">
              <td style="padding:4px 6px;font-family:var(--mono);color:${color};font-weight:600;white-space:nowrap">${range}</td>
              <td style="padding:4px 6px;color:var(--text);font-weight:${isCurrent ? '700' : '400'}">${label}${isCurrent ? ' ◀' : ''}</td>
            </tr>`;
          }).join('')}
        </table>`;
    }
  })();

  // ── Min/Max BP cards ─────────────────────────────────────────────────────
  (function renderMinMaxCards() {
    const readings = [];
    data.forEach(e => {
      const p = String(e.date).slice(0, 10).split('-');
      const dl = p[2] + '.' + p[1];
      if (e.morning.sys_l != null && e.morning.dia_l != null)
        readings.push({ sys: e.morning.sys_l, dia: e.morning.dia_l,
          pulse: e.morning.pulse_l ?? e.morning.pulse, date: dl, label: 'ранок • Л' });
      if (e.morning.sys_r != null && e.morning.dia_r != null)
        readings.push({ sys: e.morning.sys_r, dia: e.morning.dia_r,
          pulse: e.morning.pulse_r ?? e.morning.pulse, date: dl, label: 'ранок • П' });
      if (e.evening.sys_l != null && e.evening.dia_l != null)
        readings.push({ sys: e.evening.sys_l, dia: e.evening.dia_l,
          pulse: e.evening.pulse_l ?? e.evening.pulse, date: dl, label: 'вечір • Л' });
      if (e.evening.sys_r != null && e.evening.dia_r != null)
        readings.push({ sys: e.evening.sys_r, dia: e.evening.dia_r,
          pulse: e.evening.pulse_r ?? e.evening.pulse, date: dl, label: 'вечір • П' });
    });

    const noData = `<div style="color:var(--muted);font-size:12px;padding:6px 0">Немає даних</div>`;
    function cardHtml(r) {
      if (!r) return noData;
      const pulse = r.pulse != null
        ? `<div style="font-size:13px;color:var(--muted);margin:3px 0">Пульс: ${r.pulse} уд/хв</div>` : '';
      return `<div style="font-size:26px;font-weight:700;color:var(--accent);letter-spacing:.5px">${r.sys}&thinsp;/&thinsp;${r.dia}</div>
        ${pulse}
        <div style="font-size:12px;color:var(--muted);margin-top:4px">${r.date} • ${r.label}</div>`;
    }

    const minR = readings.length ? readings.reduce((a, b) => b.sys < a.sys ? b : a) : null;
    const maxR = readings.length ? readings.reduce((a, b) => b.sys > a.sys ? b : a) : null;
    document.getElementById('minBpCardBody').innerHTML = cardHtml(minR);
    document.getElementById('maxBpCardBody').innerHTML = cardHtml(maxR);
  })();

  function avgOf(arr) { const a = arr.filter(x=>x!=null); return a.length ? Math.round(a.reduce((s,x)=>s+x,0)/a.length) : null; }

  // ── MAP card ──────────────────────────────────────────────────────────────
  (function renderMapCard() {
    const allSys = [], allDia = [];
    data.forEach(e => {
      [e.morning.sys_l, e.morning.sys_r, e.evening.sys_l, e.evening.sys_r].forEach(v => { if (v != null) allSys.push(v); });
      [e.morning.dia_l, e.morning.dia_r, e.evening.dia_l, e.evening.dia_r].forEach(v => { if (v != null) allDia.push(v); });
    });
    const avgS = avgOf(allSys), avgD = avgOf(allDia);
    const el = document.getElementById('mapCardBody');
    if (avgS == null || avgD == null) {
      el.innerHTML = `<div style="color:var(--muted);font-size:12px">Немає даних</div>`;
      return;
    }
    const map = Math.round((avgS + 2 * avgD) / 3);
    let mapLabel, mapColor;
    if      (map < 70)   { mapLabel = 'Знижений';           mapColor = '#60a5fa'; }
    else if (map <= 100) { mapLabel = 'Норма';               mapColor = '#22c55e'; }
    else if (map <= 110) { mapLabel = 'Підвищений';          mapColor = '#f97316'; }
    else                 { mapLabel = 'Значно підвищений';   mapColor = '#ef4444'; }
    el.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap">
        <span style="font-size:26px;font-weight:700;color:${mapColor}">${map}<span style="font-size:14px;font-weight:400;margin-left:4px">мм рт.ст.</span></span>
        <span style="font-size:13px;font-weight:600;color:${mapColor}">${mapLabel}</span>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-top:5px">Відображає перфузійний тиск органів. Норма: 70–100 мм рт.ст.</div>`;
  })();
  function _hcolBp(sysArr, diaArr, color) {
    const s = avgOf(sysArr), d = avgOf(diaArr);
    return `<span style="color:${color}">${s ?? '—'}&thinsp;/&thinsp;${d ?? '—'}</span><span style="color:var(--muted);font-size:11px"> мм</span>`;
  }
  function _hcolPulse(arr) {
    const v = avgOf(arr);
    return `<span style="color:var(--accent2)">${v ?? '—'}</span><span style="color:var(--muted);font-size:11px"> уд/хв</span>`;
  }
  function _hcolRow(label, inner) {
    return `<div class="hcol-row"><div class="hcol-row-label">${label}</div><div class="hcol-row-val">${inner}</div></div>`;
  }
  document.getElementById('avgStatsBody').innerHTML = `
    <div class="history-body">
      <div class="history-col">
        <div class="history-col-title" style="color:var(--morning)">🌅 Ранок</div>
        ${_hcolRow('Ліва рука', _hcolBp(data.map(e=>e.morning.sys_l), data.map(e=>e.morning.dia_l), 'var(--morning)'))}
        ${_hcolRow('Права рука', _hcolBp(data.map(e=>e.morning.sys_r), data.map(e=>e.morning.dia_r), 'var(--morning)'))}
        ${_hcolRow('Пульс', _hcolPulse(data.map(e=>e.morning.pulse)))}
      </div>
      <div class="history-col">
        <div class="history-col-title" style="color:var(--evening)">🌙 Вечір</div>
        ${_hcolRow('Ліва рука', _hcolBp(data.map(e=>e.evening.sys_l), data.map(e=>e.evening.dia_l), 'var(--evening)'))}
        ${_hcolRow('Права рука', _hcolBp(data.map(e=>e.evening.sys_r), data.map(e=>e.evening.dia_r), 'var(--evening)'))}
        ${_hcolRow('Пульс', _hcolPulse(data.map(e=>e.evening.pulse)))}
      </div>
    </div>`;

  // — Extended statistics —
  if (data.length >= 3) { // correlation guard uses its own threshold of 10 below
    const mSysL  = data.map(e => e.morning.sys_l);
    const mDiaL  = data.map(e => e.morning.dia_l);
    const mSysR  = data.map(e => e.morning.sys_r);
    const mDiaR  = data.map(e => e.morning.dia_r);
    const eSysL  = data.map(e => e.evening.sys_l);
    const eDiaL  = data.map(e => e.evening.dia_l);
    const eSysR  = data.map(e => e.evening.sys_r);
    const eDiaR  = data.map(e => e.evening.dia_r);
    const mPulse = data.map(e => e.morning.pulse);
    const ePulse = data.map(e => e.evening.pulse);
    const wts    = data.map(e => e.weight);

    const avgMSys = avgOf(mSysL.map((v,i) => v ?? mSysR[i]));
    const avgESys = avgOf(eSysL.map((v,i) => v ?? eSysR[i]));
    const dailyIdx = (avgMSys != null && avgESys != null && avgMSys > 0)
      ? Math.round((avgMSys - avgESys) / avgMSys * 100 * 10) / 10 : null;

    function _extVal(v, unit) { return `<span>${v ?? '—'}${unit ? `<span style="color:var(--muted);font-size:11px"> ${unit}</span>` : ''}</span>`; }
    function _extPair(vL, vR, unit) {
      return `<span style="font-family:var(--mono);font-size:13px;font-weight:500">${vL ?? '—'}&thinsp;/&thinsp;${vR ?? '—'}<span style="color:var(--muted);font-size:11px"> ${unit}</span></span>`;
    }
    document.getElementById('extStatsBody').innerHTML = `
      <div class="history-body">
        <div class="history-col">
          <div class="history-col-title" style="color:var(--morning)">🌅 Ранок</div>
          ${_hcolRow('Медіана Сист. Л / П', _extPair(statMedian(mSysL), statMedian(mSysR), 'мм'))}
          ${_hcolRow('Медіана Діаст. Л / П', _extPair(statMedian(mDiaL), statMedian(mDiaR), 'мм'))}
          ${_hcolRow('Ст. відхил. Сист. Л', _extVal(statStdDev(mSysL), 'мм'))}
        </div>
        <div class="history-col">
          <div class="history-col-title" style="color:var(--evening)">🌙 Вечір</div>
          ${_hcolRow('Медіана Сист. Л / П', _extPair(statMedian(eSysL), statMedian(eSysR), 'мм'))}
          ${_hcolRow('Медіана Діаст. Л / П', _extPair(statMedian(eDiaL), statMedian(eDiaR), 'мм'))}
          ${_hcolRow('Ст. відхил. Сист. Л', _extVal(statStdDev(eSysL), 'мм'))}
        </div>
      </div>
      <div class="history-row" style="margin-top:8px">
        <span class="history-row-label">Денний індекс (ранок−вечір)/ранок</span>
        <span class="history-row-val">${dailyIdx != null ? dailyIdx + ' %' : '—'}</span>
      </div>`;

    // — WHO/ESH 2023 card —
    (function renderWhoEshCard() {
      const allSys = [], allDia = [];
      data.forEach(e => {
        [e.morning.sys_l, e.morning.sys_r, e.evening.sys_l, e.evening.sys_r].forEach(v => { if (v != null) allSys.push(v); });
        [e.morning.dia_l, e.morning.dia_r, e.evening.dia_l, e.evening.dia_r].forEach(v => { if (v != null) allDia.push(v); });
      });
      const cat = bpCategory(avgOf(allSys), avgOf(allDia));
      const el = document.getElementById('whoEshCard');
      if (!cat) { el.style.display = 'none'; return; }
      el.style.display = '';

      const WHO_NEIGHBORS = {
        'Оптимальний':       { prev: null,                  next: 'Нормальний' },
        'Нормальний':        { prev: 'Оптимальний',         next: 'Висок. нормальний' },
        'Висок. нормальний': { prev: 'Нормальний',          next: 'Гіпертензія 1 ст.' },
        'Ізол. сист. АГ':    { prev: 'Висок. нормальний',  next: 'Гіпертензія 1 ст.' },
        'Ізол. діаст. АГ':   { prev: 'Висок. нормальний',  next: 'Гіпертензія 1 ст.' },
        'Гіпертензія 1 ст.': { prev: 'Висок. нормальний',  next: 'Гіпертензія 2 ст.' },
        'Гіпертензія 2 ст.': { prev: 'Гіпертензія 1 ст.', next: 'Гіпертензія 3 ст.' },
        'Гіпертензія 3 ст.': { prev: 'Гіпертензія 2 ст.', next: null },
      };
      const nb = WHO_NEIGHBORS[cat.label] || { prev: null, next: null };
      const side = (label, dir) => label
        ? `<div style="font-size:10px;color:var(--muted);margin-bottom:3px">${dir}</div>
           <div style="font-size:11px;color:var(--muted);font-weight:500;line-height:1.3">${label}</div>`
        : '';

      el.innerHTML = `<div class="stat-card" style="margin-bottom:10px">
        <div class="stat-title">🩺 WHO/ESH 2023</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <div style="flex:1;text-align:left">${side(nb.prev, '‹')}</div>
          <div style="flex:0 0 auto;text-align:center;padding:0 4px">
            <div style="font-size:22px;font-weight:700;color:${cat.color};line-height:1.2">${cat.label}</div>
          </div>
          <div style="flex:1;text-align:right">${side(nb.next, '›')}</div>
        </div>
      </div>`;
    })();

    // — Cardiovascular risk + lab-results cards (after WHO/ESH) —
    renderRiskCard();
    renderLabsCard();

    // — Trends (linear regression over selected period) —
    (function renderTrends() {
      const avgSysArr  = data.map(e => { const v = [e.morning.sys_l, e.morning.sys_r, e.evening.sys_l, e.evening.sys_r].filter(x=>x!=null); return v.length ? Math.round(v.reduce((a,b)=>a+b,0)/v.length) : null; });
      const avgDiaArr  = data.map(e => { const v = [e.morning.dia_l, e.morning.dia_r, e.evening.dia_l, e.evening.dia_r].filter(x=>x!=null); return v.length ? Math.round(v.reduce((a,b)=>a+b,0)/v.length) : null; });
      const pulseArr   = data.map(e => { const v = [e.morning.pulse, e.evening.pulse].filter(x=>x!=null); return v.length ? Math.round(v.reduce((a,b)=>a+b,0)/v.length) : null; });
      const weightArr  = data.map(e => e.weight != null ? parseFloat(e.weight) : null);

      function trendRow(label, arr, unit, threshold, decimals) {
        const slope = linearSlope(arr);
        const pts = arr.filter(x => x != null).length;
        if (slope == null || pts < 2) return `<div class="stat-row"><span>${label}</span><span style="color:var(--muted)">—</span></div>`;
        const total = slope * (arr.length - 1);
        const abs = Math.abs(total);
        if (abs < threshold) return `<div class="stat-row"><span>${label}</span><span style="color:var(--muted)">без змін</span></div>`;
        const val = decimals ? total.toFixed(decimals) : Math.round(total);
        const absVal = decimals ? abs.toFixed(decimals) : Math.round(abs);
        const down = total < 0;
        const color = down ? '#22c55e' : '#ef4444';
        return `<div class="stat-row"><span>${label}</span><span style="color:${color};font-weight:600">${down ? '↓' : '↑'} ${absVal} ${unit}</span></div>`;
      }

      const el = document.getElementById('trendStatsBody');
      el.innerHTML =
        trendRow('Систолічний', avgSysArr,  'мм',   2,   0) +
        trendRow('Діастолічний', avgDiaArr,  'мм',   2,   0) +
        trendRow('Пульс',        pulseArr,   'уд/хв', 2,  0) +
        trendRow('Вага',         weightArr,  'кг',    0.3, 1);
      document.getElementById('trendStats').style.display = '';
    })();

    // — Correlation analysis (requires N≥10 for statistical reliability) —
    if (data.length >= 10) {
      const sysByDay = data.map(e => e.morning.sys_l ?? e.morning.sys_r);
      const rSysW  = pearsonR(sysByDay, wts);
      const rPulseS = pearsonR(mPulse, sysByDay);
      const rMornEve = pearsonR(sysByDay, data.map(e => e.evening.sys_l ?? e.evening.sys_r));
      const rSysWt = pearsonR(wts, data.map(e => e.morning.dia_l ?? e.morning.dia_r));

      const corrRows = [
        ['Систолічний тиск ↔ Вага', rSysW],
        ['Діастолічний тиск ↔ Вага', rSysWt],
        ['Пульс ↔ Систолічний тиск', rPulseS],
        ['Ранок ↔ Вечір (Сист.)', rMornEve],
      ];
      document.getElementById('corrStatsBody').innerHTML = corrRows.map(([label, r]) =>
        `<div class="stat-row"><span>${label}</span><span>${corrStrength(r)}</span></div>`
      ).join('');
      document.getElementById('corrStats').style.display = '';
    } else {
      document.getElementById('corrStatsBody').innerHTML =
        `<p style="color:var(--muted);font-size:.85rem">Потрібно щонайменше 10 записів (є ${data.length})</p>`;
      document.getElementById('corrStats').style.display = '';
    }

    document.getElementById('extStats').style.display = '';
  } else {
    document.getElementById('extStats').style.display = 'none';
    document.getElementById('trendStats').style.display = 'none';
    document.getElementById('corrStats').style.display = 'none';
  }
}

