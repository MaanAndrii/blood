// ── SAVE ────────────────────────────────────────────────────────────────────
async function saveEntry() {
  const date = document.getElementById('entryDate').value;
  if (!date) { showToast('⚠️ Оберіть дату', 'var(--warn)'); return; }

  // Persist current roller position before reading
  _saveRollerToFormData();
  const fd = rollerFormData;
  const wt       = v('weight');
  const notesVal = document.getElementById('notes').value.trim();

  // Confirm if nothing entered
  const hasBP = ['morning','evening'].some(p =>
    ['sys_l','dia_l','pulse_l','sys_r','dia_r','pulse_r'].some(k => fd[p][k] !== null)
  );
  if (!hasBP && wt === null && !notesVal) {
    if (!confirm('Всі значення порожні. Зберегти порожній запис?')) return;
  }

  // Validate: systolic must exceed diastolic
  const bpPairs = [
    ['Ранок ліва', fd.morning.sys_l, fd.morning.dia_l],
    ['Ранок права', fd.morning.sys_r, fd.morning.dia_r],
    ['Вечір ліва',  fd.evening.sys_l, fd.evening.dia_l],
    ['Вечір права', fd.evening.sys_r, fd.evening.dia_r],
  ];
  for (const [label, sys, dia] of bpPairs) {
    if (sys !== null && dia !== null && sys <= dia) {
      showToast(`⚠️ ${label}: систолічний (${sys}) має бути більший за діастолічний (${dia})`, 'var(--warn)');
      return;
    }
  }

  const avgPulse = (p) => {
    const pl = fd[p].pulse_l, pr = fd[p].pulse_r;
    if (pl !== null && pr !== null) return Math.round((pl + pr) / 2);
    return pl ?? pr ?? null;
  };

  const entry = {
    date,
    morning: {
      sys_l:   fd.morning.sys_l,
      dia_l:   fd.morning.dia_l,
      sys_r:   fd.morning.sys_r,
      dia_r:   fd.morning.dia_r,
      pulse:   avgPulse('morning'),
      pulse_l: fd.morning.pulse_l,
      pulse_r: fd.morning.pulse_r,
    },
    evening: {
      sys_l:   fd.evening.sys_l,
      dia_l:   fd.evening.dia_l,
      sys_r:   fd.evening.sys_r,
      dia_r:   fd.evening.dia_r,
      pulse:   avgPulse('evening'),
      pulse_l: fd.evening.pulse_l,
      pulse_r: fd.evening.pulse_r,
    },
    weight: wt,
    notes:  notesVal || null,
    saved:  new Date().toISOString()
  };

  const prevDate = editingDate;
  const dateChanged = prevDate !== null && prevDate !== date;

  showLoading('Збереження…');
  try {
    const saved = await saveEntryToServer(entry);
    if (dateChanged) await deleteEntryFromServer(prevDate);
    if (dateChanged) entries = entries.filter(e => String(e.date).slice(0,10) !== prevDate);
    entries = entries.filter(e => String(e.date).slice(0,10) !== date);
    entries.push(saved || entry);
    entries.sort((a,b) => String(b.date).localeCompare(String(a.date)));
    saveLocalData(entries);
  } catch (err) {
    // Network error or 5xx: queue locally and show non-blocking warning
    const isNetworkError = err instanceof TypeError;
    const is5xx = err.status >= 500;
    if (isNetworkError || is5xx) {
      enqueuePendingEntry(entry);
      // Still show in UI optimistically
      entries = entries.filter(e => String(e.date).slice(0,10) !== date);
      entries.push(entry);
      entries.sort((a,b) => String(b.date).localeCompare(String(a.date)));
      saveLocalData(entries);
      showToast('📶 Немає зв\'язку · запис збережено локально', 'var(--warn)');
    } else {
      hideLoading();
      showToast('⚠️ ' + err.message, 'var(--warn)');
      return;
    }
  }
  hideLoading();
  closeEntryModal();

  const summary = _buildSaveSummary(entry);
  if (prevDate !== null) {
    showToast('✏️ ' + summary);
    const activePage = document.querySelector('.page.active')?.id?.replace('page-', '');
    if (activePage === 'history') renderHistory();
  } else {
    showToast('✅ ' + summary);
  }
  showDayOnHome(todayStr());
  renderWeekStrip();
  renderHomeChart();
  updateFabLabel();
}

function _buildSaveSummary(entry) {
  const m = entry.morning, e = entry.evening;
  const parts = [];
  if (m.sys_l && m.dia_l) parts.push(`Р.Л ${m.sys_l}/${m.dia_l}`);
  if (m.sys_r && m.dia_r) parts.push(`Р.П ${m.sys_r}/${m.dia_r}`);
  if (m.pulse)             parts.push(`♥ ${m.pulse}`);
  if (e.sys_l && e.dia_l) parts.push(`В.Л ${e.sys_l}/${e.dia_l}`);
  if (e.sys_r && e.dia_r) parts.push(`В.П ${e.sys_r}/${e.dia_r}`);
  if (e.pulse)             parts.push(`♥ ${e.pulse}`);
  if (entry.weight)        parts.push(`⚖️ ${entry.weight} кг`);
  return parts.length ? parts.join(' · ') : 'Збережено';
}

function fillFormFromEntry(e) {
  rollerFormData = {
    morning: {
      sys_l:   e.morning.sys_l   ?? null,
      dia_l:   e.morning.dia_l   ?? null,
      pulse_l: e.morning.pulse_l ?? null,
      sys_r:   e.morning.sys_r   ?? null,
      dia_r:   e.morning.dia_r   ?? null,
      pulse_r: e.morning.pulse_r ?? null,
    },
    evening: {
      sys_l:   e.evening.sys_l   ?? null,
      dia_l:   e.evening.dia_l   ?? null,
      pulse_l: e.evening.pulse_l ?? null,
      sys_r:   e.evening.sys_r   ?? null,
      dia_r:   e.evening.dia_r   ?? null,
      pulse_r: e.evening.pulse_r ?? null,
    },
  };
  // Mark all non-null combinations as touched
  rollerTouched = new Set();
  ['morning', 'evening'].forEach(p => {
    ['l','r'].forEach(h => {
      if (rollerFormData[p]['sys_' + h] !== null) rollerTouched.add(p + '-' + h);
    });
  });
  rollerPeriod = 'morning';
  rollerHand = 'l';
  document.getElementById('btn-period-morning')?.classList.add('active');
  document.getElementById('btn-period-evening')?.classList.remove('active');
  document.getElementById('btn-hand-l')?.classList.add('active');
  document.getElementById('btn-hand-r')?.classList.remove('active');
  _loadRollerFromFormData();
  updateRollerHint();
  updateToggleStatus();
  document.getElementById('weight').value = e.weight ?? '';
  document.getElementById('notes').value  = e.notes  ?? '';
}

function goToday() {
  const today = todayStr();
  const input = document.getElementById('entryDate');
  if (input.value === today) return;
  input.value = today;
  onDateChange(today);
}

function onDateChange(date) {
  if (editingDate) return;
  const e = entries.find(x => String(x.date).slice(0,10) === date);
  if (e) {
    showToast('📋 Цей день вже має дані. Редагуйте через Журнал.', 'var(--warn)');
  }
  resetRollerState();
  document.getElementById('weight').value = '';
  document.getElementById('notes').value  = '';
}

async function editEntry(date) {
  await fetchEntries();
  openEntryModal(date, true);
}

function cancelEdit() {
  closeEntryModal();
}

function openEntryModal(date, allowEdit = false) {
  const d = date || todayStr();
  const e = entries.find(x => String(x.date).slice(0,10) === d);

  if (e && !allowEdit) {
    showToast('📋 Дані вже внесені. Редагуйте через Журнал.', 'var(--warn)');
    return;
  }

  resetRollerState();
  document.getElementById('weight').value = '';
  document.getElementById('notes').value = '';
  editingDate = null;
  setEditMode(false);
  document.getElementById('entryDate').value = d;

  if (e && allowEdit) {
    editingDate = d;
    setEditMode(true);
    document.getElementById('entryModalTitle').textContent = 'Редагування — ' + fmtDate(d);
    document.getElementById('entryDateRow').style.display = 'none';
    document.getElementById('entryModal').classList.add('open');
    requestAnimationFrame(() => {
      fillFormFromEntry(e);
    });
  } else {
    document.getElementById('entryModalTitle').textContent = 'Новий запис';
    document.getElementById('entryDateRow').style.display = '';
    document.getElementById('entryModal').classList.add('open');
  }
}

function closeEntryModal() {
  editingDate = null;
  setEditMode(false);
  resetRollerState();
  document.getElementById('weight').value = '';
  document.getElementById('notes').value = '';
  document.getElementById('entryDateRow').style.display = '';
  document.getElementById('entryModal').classList.remove('open');
}

function setEditMode(on) {
  document.getElementById('editBanner').classList.toggle('active', on);
  document.getElementById('btnSave').innerHTML = on
    ? '✏️ Оновити запис'
    : '💾 Зберегти запис';
}

