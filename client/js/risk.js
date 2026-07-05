// ── CARDIOVASCULAR RISK (risk.js) ───────────────────────────────────────────
// Two 10-year cardiovascular risk estimators:
//   1. Framingham "non-laboratory" (BMI-based) — D'Agostino et al., Circulation
//      2008;117:743-753 (General Cardiovascular Risk Profile). Uses no blood
//      tests: sex, age, BMI, systolic BP (treated/untreated), smoking, diabetes.
//   2. SCORE2 / SCORE2-OP — SCORE2 working group & ESC, Eur Heart J 2021;42:2439.
//      Uses sex, age, smoking, systolic BP, total + HDL cholesterol. Calibrated
//      here to the "Very high risk" region (Ukraine per the 2021 ESC map).
//
// IMPORTANT: both models are calibrated on office (clinic) blood pressure, while
// this app records home measurements (thresholds differ by ~5 mmHg). Results are
// an orientation only, never a diagnosis. Always shown with a disclaimer.

// ── Shared helpers ────────────────────────────────────────────────────────────
function ageFromDob(dob) {
  if (!dob) return null;
  const b = new Date(String(dob).slice(0, 10));
  if (isNaN(b.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a;
}

// Representative systolic BP: mean of all systolic readings (both periods, both
// arms) over the last `days`. Returns { mean, n } or null when no data.
function recentSystolic(days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = _localDateStr(cutoff);
  const vals = [];
  for (const e of entries) {
    if (String(e.date).slice(0, 10) < cutoffStr) continue;
    for (const p of [e.morning, e.evening]) {
      if (!p) continue;
      if (p.sys_l != null) vals.push(Number(p.sys_l));
      if (p.sys_r != null) vals.push(Number(p.sys_r));
    }
  }
  if (!vals.length) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { mean: Math.round(mean), n: vals.length };
}

function _clampRisk(r) {
  if (r == null || isNaN(r)) return null;
  return Math.max(0, Math.min(100, r * 100));
}

// ── Framingham non-laboratory (BMI) 10-year CVD risk, % ───────────────────────
// Coefficients from D'Agostino 2008, Table 5 (simple/office model with BMI).
function framinghamNonLab({ sex, age, bmi, sbp, treated, smoker, diabetic }) {
  if (!sex || age == null || !bmi || !sbp) return null;
  if (age < 30 || age > 74) return null; // model derived on ~30-74 y
  const ln = Math.log;
  const sm = smoker ? 1 : 0, db = diabetic ? 1 : 0;
  let L, s0, mean;
  if (sex === 'male') {
    L = 3.11296 * ln(age)
      + 0.79277 * ln(bmi)
      + (treated ? 1.92672 : 1.85508) * ln(sbp)
      + 0.70953 * sm
      + 0.53160 * db;
    s0 = 0.88431; mean = 23.9802;
  } else {
    L = 2.72107 * ln(age)
      + 0.51125 * ln(bmi)
      + (treated ? 2.88267 : 2.81291) * ln(sbp)
      + 0.61868 * sm
      + 0.77763 * db;
    s0 = 0.94833; mean = 26.0145;
  }
  return _clampRisk(1 - Math.pow(s0, Math.exp(L - mean)));
}

// Standard Framingham risk bands
function framinghamCategory(pct) {
  if (pct < 10)  return { label: 'Низький',    color: '#22c55e' };
  if (pct < 20)  return { label: 'Помірний',   color: '#eab308' };
  return           { label: 'Високий',    color: '#ef4444' };
}

// ── SCORE2 / SCORE2-OP, "Very high risk" region, 10-year CVD risk, % ──────────
// Coefficients & calibration scales from ESC 2021 SCORE2 supplement (very-high
// region). Total & HDL cholesterol in mmol/L.
function score2VeryHigh({ sex, age, sbp, smoker, diabetic, totalChol, hdl }) {
  if (!sex || age == null || !sbp || totalChol == null || hdl == null) return null;
  if (age < 40 || age > 89) return null; // SCORE2 40-69, SCORE2-OP 70-89
  const female = sex === 'female';
  const sm = smoker ? 1 : 0, db = diabetic ? 1 : 0;
  const L = Math.log, E = Math.exp;
  let risk;

  if (age < 70) {
    // SCORE2
    const cage = (age - 60) / 5;
    const csbp = (sbp - 120) / 20;
    const cchol = (totalChol - 6);       // centering /1
    const chdl = (hdl - 1.3) / 0.5;
    let x, base, s1, s2;
    if (!female) {
      x = 0.3742 * cage + 0.6012 * sm + 0.2777 * csbp + 0.6457 * db
        + 0.1458 * cchol + (-0.2698) * chdl
        + (-0.0755) * cage * sm + (-0.0255) * cage * csbp
        + (-0.0281) * cage * cchol + 0.0426 * cage * chdl + (-0.0983) * cage * db;
      base = 0.9605; s1 = 0.5836; s2 = 0.8294;
    } else {
      x = 0.4648 * cage + 0.7744 * sm + 0.3131 * csbp + 0.8096 * db
        + 0.1002 * cchol + (-0.2606) * chdl
        + (-0.1088) * cage * sm + (-0.0277) * cage * csbp
        + (-0.0226) * cage * cchol + 0.0613 * cage * chdl + (-0.1272) * cage * db;
      base = 0.9776; s1 = 0.9412; s2 = 0.8329;
    }
    const r0 = 1 - Math.pow(base, E(x));
    risk = 1 - E(-E(s1 + s2 * L(-L(1 - r0))));
  } else {
    // SCORE2-OP (older population)
    const ca = age - 73;
    let x, base, mean, s1, s2;
    if (!female) {
      x = 0.0634 * ca + 0.4245 * db + 0.3524 * sm + 0.0094 * (sbp - 150)
        + 0.0850 * (totalChol - 6) + (-0.3564) * (hdl - 1.4)
        + (-0.0174) * ca * db + (-0.0247) * ca * sm + (-0.0005) * ca * (sbp - 150)
        + 0.0073 * ca * (totalChol - 6) + 0.0091 * ca * (hdl - 1.4);
      base = 0.7576; mean = 0.0929; s1 = 0.05; s2 = 0.7;
    } else {
      x = 0.0789 * ca + 0.6010 * db + 0.4921 * sm + 0.0102 * (sbp - 150)
        + 0.0605 * (totalChol - 6) + (-0.3040) * (hdl - 1.4)
        + (-0.0107) * ca * db + (-0.0255) * ca * sm + (-0.0004) * ca * (sbp - 150)
        + (-0.0009) * ca * (totalChol - 6) + 0.0154 * ca * (hdl - 1.4);
      base = 0.8082; mean = 0.229; s1 = 0.38; s2 = 0.69;
    }
    const r0 = 1 - Math.pow(base, E(x - mean));
    risk = 1 - E(-E(s1 + s2 * L(-L(1 - r0))));
  }
  return _clampRisk(risk);
}

// SCORE2 risk bands are age-dependent (ESC 2021)
function score2Category(pct, age) {
  let lowMax, modMax;
  if (age < 50)       { lowMax = 2.5; modMax = 7.5; }
  else if (age < 70)  { lowMax = 5;   modMax = 10; }
  else                { lowMax = 7.5; modMax = 15; }
  if (pct < lowMax)   return { label: 'Низький',  color: '#22c55e' };
  if (pct < modMax)   return { label: 'Помірний', color: '#eab308' };
  return                { label: 'Високий',  color: '#ef4444' };
}

// ── Card rendering ────────────────────────────────────────────────────────────
function renderRiskCard() {
  const el = document.getElementById('riskCard');
  if (!el) return;
  const u = currentUser || {};

  const age = ageFromDob(u.date_of_birth);
  const sbpInfo = recentSystolic(30);
  const lastWeight = entries.find(e => e.weight != null)?.weight;
  const bmi = lastWeight && u.height_cm ? calcBmi(Number(lastWeight), u.height_cm) : null;
  const totalChol = u.total_cholesterol != null ? Number(u.total_cholesterol) : null;
  const hdl = u.hdl_cholesterol != null ? Number(u.hdl_cholesterol) : null;

  // Prompt if the essentials (sex + DOB) are missing.
  if (!u.sex || age == null) {
    el.innerHTML = `
      <div class="card" style="padding:14px">
        <div style="font-weight:600;margin-bottom:6px">❤️ Серцево-судинний ризик</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:10px">
          Вкажіть стать і дату народження у профілі, щоб оцінити 10-річний ризик серцево-судинних подій.
        </div>
        <button class="btn-outline" style="width:100%" onclick="openProfileModal()">Заповнити профіль</button>
      </div>`;
    return;
  }

  if (!sbpInfo) {
    el.innerHTML = `
      <div class="card" style="padding:14px">
        <div style="font-weight:600;margin-bottom:6px">❤️ Серцево-судинний ризик</div>
        <div style="font-size:12px;color:var(--muted)">
          Немає вимірювань тиску за останні 30 днів — внесіть показники, щоб розрахувати ризик.
        </div>
      </div>`;
    return;
  }

  const treated = !!u.on_bp_meds;
  const fr = framinghamNonLab({
    sex: u.sex, age, bmi, sbp: sbpInfo.mean,
    treated, smoker: u.smoker, diabetic: u.diabetic,
  });
  const sc = score2VeryHigh({
    sex: u.sex, age, sbp: sbpInfo.mean,
    smoker: u.smoker, diabetic: u.diabetic, totalChol, hdl,
  });

  const gauge = (pct, cat) => `
    <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
      <span style="font-size:30px;font-weight:700;font-family:var(--mono);color:${cat.color}">${pct.toFixed(1)}%</span>
      <span style="font-size:13px;font-weight:600;color:${cat.color}">${cat.label} ризик</span>
    </div>
    <div style="height:6px;border-radius:3px;background:var(--surface);margin-top:6px;overflow:hidden">
      <div style="height:100%;width:${Math.min(100, pct * 2)}%;background:${cat.color}"></div>
    </div>`;

  let body = '';

  if (fr != null) {
    const cat = framinghamCategory(fr);
    body += `<div style="margin-bottom:12px">
      ${gauge(fr, cat)}
      <div class="summary-label" style="margin-top:5px">Framingham (за ІМТ) · 10 років</div>
    </div>`;
  } else {
    const miss = !bmi ? 'вагу та зріст' : (age < 30 || age > 74 ? 'вік поза межами моделі (30–74)' : 'дані');
    body += `<div style="font-size:11px;color:var(--muted);margin-bottom:10px">Framingham: вкажіть ${miss}.</div>`;
  }

  if (sc != null) {
    const cat = score2Category(sc, age);
    body += `<div style="margin-bottom:10px;padding-top:10px;border-top:1px solid var(--border)">
      ${gauge(sc, cat)}
      <div class="summary-label" style="margin-top:5px">SCORE2${age >= 70 ? '-OP' : ''} (ESC, регіон дуже високого ризику) · 10 років</div>
    </div>`;
  } else {
    const need = (totalChol == null || hdl == null)
      ? 'загальний і HDL холестерин у профілі'
      : (age < 40 ? 'вік ≥ 40 років' : 'дані');
    body += `<div style="font-size:11px;color:var(--muted);margin-bottom:6px;padding-top:8px;border-top:1px solid var(--border)">SCORE2: додайте ${need}.</div>`;
  }

  el.innerHTML = `
    <div class="card" style="padding:14px">
      <div style="font-weight:600;margin-bottom:10px">❤️ Серцево-судинний ризик</div>
      ${body}
      <div style="font-size:10px;color:var(--muted);margin-top:8px;line-height:1.4">
        Розрахунок за середнім систолічним тиском ${sbpInfo.mean} мм рт. ст. (${sbpInfo.n} вимір.
        за 30 днів)${treated ? ', з урахуванням прийому ліків від тиску' : ''}.
        Орієнтовна оцінка на основі домашніх вимірювань — не є діагнозом і не замінює консультацію лікаря.
      </div>
    </div>`;
}
