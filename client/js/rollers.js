// ── DRUM ROLLERS ────────────────────────────────────────────────────────────
const ITEM_H = 52;
// nullAt: insert "—" item between this value and the next (natural "unset" default)
const ROLLER_CFG = [
  { id: 'sys',   min: 60,  max: 240, nullAt: 119 },
  { id: 'dia',   min: 40,  max: 140, nullAt: 79  },
  { id: 'pulse', min: 30,  max: 200, nullAt: 69  },
];

let rollerPeriod  = 'morning';
let rollerHand    = 'l';
let rollerTouched = new Set();

let rollerFormData = {
  morning: { sys_l: null, dia_l: null, pulse_l: null, sys_r: null, dia_r: null, pulse_r: null },
  evening: { sys_l: null, dia_l: null, pulse_l: null, sys_r: null, dia_r: null, pulse_r: null },
};

const _rollerKey = () => rollerPeriod + '-' + rollerHand;

// ty = ITEM_H * (1 - idx) centers item[idx] in the 156px outer (3 × ITEM_H)
function _applyRollerTransform(track, animate) {
  track.style.transition = animate ? 'transform 0.18s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none';
  track.style.transform  = `translateY(${ITEM_H * (1 - track._idx)}px)`;
}

function _attachPointerEvents(track, cfg) {
  const outer    = track.parentElement;
  const count    = track.querySelectorAll('.roller-item').length;
  const maxTy    = ITEM_H;
  const minTy    = ITEM_H * (1 - (count - 1));
  let startY = 0, startTy = 0, dragging = false, prevIdx = -1;

  outer.addEventListener('pointerdown', e => {
    e.preventDefault();
    outer.setPointerCapture(e.pointerId);
    dragging = true;
    startY  = e.clientY;
    startTy = ITEM_H * (1 - track._idx);
    _applyRollerTransform(track, false);
  });

  outer.addEventListener('pointermove', e => {
    if (!dragging) return;
    const ty   = Math.max(minTy, Math.min(maxTy, startTy + (e.clientY - startY)));
    const idx  = Math.max(0, Math.min(count - 1, Math.round((ITEM_H - ty) / ITEM_H)));
    track._idx = idx;
    track.style.transform = `translateY(${ty}px)`;
    if (idx !== prevIdx) { _updateRollerVisuals(cfg.id); prevIdx = idx; }
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    prevIdx  = -1;
    rollerTouched.add(_rollerKey());
    _applyRollerTransform(track, true);
    _updateRollerVisuals(cfg.id);
    _saveRollerToFormData();
  }

  outer.addEventListener('pointerup',     endDrag);
  outer.addEventListener('pointercancel', endDrag);
}

function initRollers() {
  ROLLER_CFG.forEach(cfg => {
    const track = document.getElementById('roller-' + cfg.id);
    if (!track) return;
    track.innerHTML = '';
    const nullEl = document.createElement('div');
    nullEl.className = 'roller-item roller-null';
    nullEl.dataset.value = '';
    nullEl.textContent = '—';
    for (let val = cfg.min; val <= cfg.max; val++) {
      if (val === cfg.nullAt + 1) track.appendChild(nullEl);
      const el = document.createElement('div');
      el.className = 'roller-item';
      el.dataset.value = val;
      el.textContent = val;
      track.appendChild(el);
    }
    _setRollerValue(cfg.id, null);
    _attachPointerEvents(track, cfg);
  });
  updateRollerHint();
  updateToggleStatus();
}

function _updateRollerVisuals(id) {
  const track = document.getElementById('roller-' + id);
  if (!track) return;
  const idx = track._idx ?? 0;
  track.querySelectorAll('.roller-item').forEach((el, i) => {
    el.classList.remove('selected', 'near');
    if (i === idx) el.classList.add('selected');
    else if (Math.abs(i - idx) === 1) el.classList.add('near');
  });
}

// Set roller to a specific value (or null → "—" item); instant, no animation
function _setRollerValue(id, value) {
  const track = document.getElementById('roller-' + id);
  if (!track) return;
  const items = track.querySelectorAll('.roller-item');
  let idx = -1;
  items.forEach((item, i) => {
    if (value === null || value === undefined) {
      if (item.dataset.value === '') idx = i;
    } else {
      if (parseInt(item.dataset.value, 10) === value) idx = i;
    }
  });
  if (idx === -1) return;
  track._idx = idx;
  _applyRollerTransform(track, false);
  _updateRollerVisuals(id);
}

// Returns current selected value, or null if "—" is selected
function _getRollerValue(id) {
  const track = document.getElementById('roller-' + id);
  if (!track) return null;
  const items = track.querySelectorAll('.roller-item');
  const item  = items[track._idx ?? 0];
  if (!item || item.dataset.value === '') return null;
  return parseInt(item.dataset.value, 10);
}

function _saveRollerToFormData() {
  const key = _rollerKey();
  if (!rollerTouched.has(key)) return;
  const h = rollerHand, p = rollerPeriod;
  rollerFormData[p]['sys_'   + h] = _getRollerValue('sys');
  rollerFormData[p]['dia_'   + h] = _getRollerValue('dia');
  rollerFormData[p]['pulse_' + h] = _getRollerValue('pulse');
  updateToggleStatus();
}

function _loadRollerFromFormData() {
  const h = rollerHand, p = rollerPeriod;
  _setRollerValue('sys',   rollerFormData[p]['sys_'   + h]);
  _setRollerValue('dia',   rollerFormData[p]['dia_'   + h]);
  _setRollerValue('pulse', rollerFormData[p]['pulse_' + h]);
}

// Show green dot on period/hand buttons that already have data
function updateToggleStatus() {
  const fd = rollerFormData;
  ['morning', 'evening'].forEach(p => {
    const has = fd[p].sys_l !== null || fd[p].sys_r !== null;
    document.getElementById('btn-period-' + p)?.classList.toggle('has-data', has);
  });
  ['l', 'r'].forEach(h => {
    const has = fd[rollerPeriod]['sys_' + h] !== null;
    document.getElementById('btn-hand-' + h)?.classList.toggle('has-data', has);
  });
}

function setRollerPeriod(p) {
  _saveRollerToFormData();
  rollerPeriod = p;
  document.getElementById('btn-period-morning').classList.toggle('active', p === 'morning');
  document.getElementById('btn-period-evening').classList.toggle('active', p === 'evening');
  _loadRollerFromFormData();
  updateRollerHint();
  updateToggleStatus();
}

function setRollerHand(h) {
  _saveRollerToFormData();
  rollerHand = h;
  document.getElementById('btn-hand-l').classList.toggle('active', h === 'l');
  document.getElementById('btn-hand-r').classList.toggle('active', h === 'r');
  _loadRollerFromFormData();
  updateRollerHint();
  updateToggleStatus();
}

function updateRollerHint() {
  const el = document.getElementById('rollerHint');
  if (!el) return;
  const p = rollerPeriod === 'morning' ? 'Ранок' : 'Вечір';
  const h = rollerHand === 'l' ? 'ліва рука' : 'права рука';
  el.textContent = p + ' — ' + h;
}

function resetRollerState() {
  rollerPeriod = 'morning';
  rollerHand = 'l';
  rollerTouched = new Set();
  rollerFormData = {
    morning: { sys_l: null, dia_l: null, pulse_l: null, sys_r: null, dia_r: null, pulse_r: null },
    evening: { sys_l: null, dia_l: null, pulse_l: null, sys_r: null, dia_r: null, pulse_r: null },
  };
  document.getElementById('btn-period-morning')?.classList.add('active');
  document.getElementById('btn-period-evening')?.classList.remove('active');
  document.getElementById('btn-hand-l')?.classList.add('active');
  document.getElementById('btn-hand-r')?.classList.remove('active');
  _loadRollerFromFormData();
  updateRollerHint();
  updateToggleStatus();
}

