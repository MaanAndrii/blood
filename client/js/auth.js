// ── AUTH ────────────────────────────────────────────────────────────────────
function showLoginScreen() {
  window.location.href = '/';
}

function showApp() {
  document.getElementById('appShell').style.display = 'flex';
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch {}
  localStorage.removeItem(DB_KEY);
  localStorage.removeItem(REMINDER_KEY);
  window.location.href = '/';
}


function openPrivacyModal()  { document.getElementById('privacyModal').classList.add('open'); }
function closePrivacyModal() { document.getElementById('privacyModal').classList.remove('open'); }

function confirmDeleteAccount() {
  const input = document.getElementById('deleteConfirmInput');
  if (input) input.value = '';
  const btn = document.getElementById('btnConfirmDelete');
  if (btn) btn.disabled = true;
  document.getElementById('deleteAccountModal').classList.add('open');
}

function closeDeleteAccountModal() {
  document.getElementById('deleteAccountModal').classList.remove('open');
}

async function executeDeleteAccount() {
  if (document.getElementById('deleteConfirmInput')?.value !== 'DELETE') return;
  closeDeleteAccountModal();
  showLoading('Видалення акаунту…');
  try {
    const r = await fetch('/api/users/me', { method: 'DELETE' });
    hideLoading();
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Помилка');
    window.location.href = '/?deleted=1';
  } catch (err) {
    hideLoading();
    showToast('⚠️ ' + err.message, 'var(--warn)');
  }
}

async function initApp() {
  if (window.location.pathname !== '/') history.replaceState({}, '', '/');
  try {
    const r = await fetch('/api/auth/me');
    if (!r.ok) {
      showLoginScreen();
      return;
    }
    currentUser = await r.json();
    renderUserChip();
    applyTierRestrictions();

    await fetchEntries();
    await fetchLabs();
    showApp();
    _initJournalPicker();
    initRollers();
    _updateChipSync();
    flushPendingEntries();

    // Init page
    const days = ['Нд','Пн','Вт','Ср','Чт','Пт','Сб'];
    const now = new Date();
    document.getElementById('headerDate').textContent =
      `${days[now.getDay()]}, ${now.getDate()}.${String(now.getMonth()+1).padStart(2,'0')}`;
    showDayOnHome(todayStr());
    renderWeekStrip();
    renderHomeChart();
    updateFabLabel();

    // Sync reminder settings from server if localStorage is missing/empty
    const stored = loadReminderSettings();
    if (!stored.morning && currentUser.reminder_morning) {
      const synced = {
        enabled:  currentUser.reminders_enabled ?? false,
        morning:  currentUser.reminder_morning || '08:00',
        evening:  currentUser.reminder_evening || '20:00',
        timezone: currentUser.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      localStorage.setItem(REMINDER_KEY, JSON.stringify(synced));
    }

    // Restore push settings from local
    const s = loadReminderSettings();
    scheduleReminders(s);

    // Init push subscription if reminders enabled; save to server if (re)created
    if (s.enabled && 'serviceWorker' in navigator && 'PushManager' in window) {
      initPushSubscription(s).then(sub => {
        if (sub) savePushSettingsToServer({ subscription: sub }).catch(() => {});
      }).catch(() => {});
    }

    // First login: open profile if personal data not yet filled
    if (!currentUser.date_of_birth && !currentUser.height_cm) {
      setTimeout(() => openProfileModal(), 400);
    }

    // Handle Drive OAuth callback redirect
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('drive_connected') === '1') {
      history.replaceState({}, '', window.location.pathname);
      showToast('✅ Google Drive підключено!');
      setTimeout(() => openDriveModal(true), 300);
    } else if (urlParams.get('error')?.startsWith('drive_')) {
      history.replaceState({}, '', window.location.pathname);
      const msgs = {
        drive_no_callback_url: 'GOOGLE_DRIVE_CALLBACK_URL не налаштовано в .env',
        drive_no_client_id:    'GOOGLE_CLIENT_ID не налаштовано в .env',
        drive_denied:          'Не вдалося підключити Drive — доступ відхилено. Спробуйте ще раз.',
        drive_token_failed:    'Не вдалося підключити Drive — помилка отримання токена.',
        drive_callback_failed: 'Не вдалося підключити Drive. Перевірте доступи Google і спробуйте ще раз.',
        drive_bad_state:       'Помилка авторизації Drive. Спробуйте ще раз.',
      };
      const code = urlParams.get('error');
      showToast('❌ ' + (msgs[code] || 'Помилка Drive: ' + code), 'var(--warn)');
    }
  } catch (err) {
    console.error('initApp error:', err);
    showLoginScreen();
  }
}

// ── USER CHIP ───────────────────────────────────────────────────────────────
function renderUserChip() {
  if (!currentUser) return;
  const name = currentUser.name || currentUser.email || '';
  const initials = name.split(' ').slice(0,2).map(w => w[0] || '').join('').toUpperCase() || '?';
  document.getElementById('userChipName').textContent = name.split(' ')[0] || name;

  const avatarEl = document.getElementById('userChipAvatar');
  if (currentUser.avatar_url) {
    avatarEl.innerHTML = '';
    avatarEl.className = '';
    avatarEl.style.cssText = 'width:26px;height:26px;border-radius:50%;overflow:hidden;flex-shrink:0';
    const img = document.createElement('img');
    img.src = currentUser.avatar_url;
    img.alt = initials;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover';
    img.onerror = () => {
      avatarEl.innerHTML = '';
      avatarEl.className = 'user-chip-initials';
      avatarEl.style.cssText = '';
      avatarEl.textContent = initials;
    };
    avatarEl.appendChild(img);
  } else {
    avatarEl.className = 'user-chip-initials';
    avatarEl.style.cssText = '';
    avatarEl.textContent = initials;
  }

  const menu = document.getElementById('userMenu');
  menu.innerHTML = '';

  const profileItem = document.createElement('div');
  profileItem.className = 'user-menu-item';
  profileItem.textContent = '👤 Профіль';
  profileItem.onclick = () => { menu.classList.remove('open'); openProfileModal(); };
  menu.appendChild(profileItem);

  const aboutItem = document.createElement('div');
  aboutItem.className = 'user-menu-item';
  aboutItem.textContent = 'ℹ️ Про додаток';
  aboutItem.onclick = () => {
    menu.classList.remove('open');
    document.getElementById('aboutVersion').textContent = `v${APP_VERSION}`;
    openAboutModal();
  };
  menu.appendChild(aboutItem);

  if (currentUser.effective_tier === 'admin') {
    const adminItem = document.createElement('div');
    adminItem.className = 'user-menu-item';
    adminItem.textContent = '⚙️ Адмін-панель';
    adminItem.onclick = () => { window.location.href = '/admin.html'; };
    menu.appendChild(adminItem);
  }

  const logoutItem = document.createElement('div');
  logoutItem.className = 'user-menu-item danger';
  logoutItem.textContent = '🚪 Вийти';
  logoutItem.onclick = logout;
  menu.appendChild(logoutItem);
}

function toggleUserMenu() {
  document.getElementById('userMenu').classList.toggle('open');
}

function openProfileModal() {
  if (!currentUser) return;
  const name     = currentUser.name || '';
  const initials = name.split(' ').slice(0,2).map(w => w[0] || '').join('').toUpperCase() || '?';

  // Avatar
  const avatarEl = document.getElementById('profileAvatarEl');
  if (currentUser.avatar_url) {
    const img = document.createElement('img');
    img.src = currentUser.avatar_url;
    img.alt = initials;
    img.className = 'profile-avatar-img';
    img.onerror = () => { avatarEl.innerHTML = `<div class="profile-avatar-initials">${initials}</div>`; };
    avatarEl.innerHTML = '';
    avatarEl.appendChild(img);
  } else {
    avatarEl.innerHTML = `<div class="profile-avatar-initials">${initials}</div>`;
  }

  document.getElementById('profileDisplayName').textContent = name || '—';
  document.getElementById('profileEmailDisplay').textContent = currentUser.email || '';
  if (currentUser.created_at) {
    const d = new Date(currentUser.created_at);
    const fmt = d.toLocaleDateString('uk-UA', { day:'2-digit', month:'long', year:'numeric' });
    document.getElementById('profileSinceDisplay').textContent = `У системі з ${fmt}`;
  } else {
    document.getElementById('profileSinceDisplay').textContent = '';
  }

  // Tier info block
  const tierEl = document.getElementById('profileTierInfo');
  if (tierEl) {
    const effective = currentUser.effective_tier || 'free';
    const exp = currentUser.subscription_expires_at ? new Date(currentUser.subscription_expires_at) : null;
    const daysLeft = exp ? Math.ceil((exp - new Date()) / 86400000) : null;
    let label, color, detail;
    if (effective === 'admin') {
      label = 'Admin'; color = '#e74c3c';
      detail = 'Повний доступ · адміністратор системи';
    } else if (effective === 'demo') {
      const created = currentUser.created_at ? new Date(currentUser.created_at) : null;
      const demoExpiry = created ? new Date(created.getTime() + 7 * 86400000) : null;
      const demoDaysLeft = demoExpiry ? Math.ceil((demoExpiry - new Date()) / 86400000) : null;
      label = 'Demo'; color = 'var(--accent2)';
      detail = demoDaysLeft && demoDaysLeft > 0
        ? `Повний доступ · ще ${demoDaysLeft} дн. (до ${demoExpiry.toLocaleDateString('uk-UA',{day:'2-digit',month:'long'})})`
        : 'Повний доступ · демо-версія';
    } else if (effective === 'premium') {
      label = 'Premium'; color = 'var(--accent)';
      detail = exp ? `Повний доступ · до ${exp.toLocaleDateString('uk-UA',{day:'2-digit',month:'long',year:'numeric'})}` : 'Повний доступ · безстроково';
    } else {
      label = 'Free'; color = 'var(--muted)';
      detail = 'Обмежений доступ · історія 30 днів, без Експорту';
    }
    tierEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface);border-radius:var(--radius-sm);border:1px solid var(--border)">
      <span style="font-weight:700;font-size:12px;color:${color}">${label}</span>
      <span style="font-size:11px;color:var(--muted);flex:1">${detail}</span>
    </div>`;
  }

  document.getElementById('profileName').value = name;
  document.getElementById('profileDob').value  = currentUser.date_of_birth
    ? String(currentUser.date_of_birth).slice(0, 10) : '';
  const heightInput = document.getElementById('profileHeight');
  heightInput.value = currentUser.height_cm || '';
  _updateProfileBmi();
  heightInput.addEventListener('input', _updateProfileBmi);

  // Cardiovascular risk profile fields
  document.querySelectorAll('input[name="profileSex"]').forEach(r => {
    r.checked = r.value === currentUser.sex;
  });
  document.getElementById('profileSmoker').checked   = currentUser.smoker === true;
  document.getElementById('profileDiabetic').checked = currentUser.diabetic === true;
  document.getElementById('profileOnBpMeds').checked = currentUser.on_bp_meds === true;

  // Password section: show "Поточний пароль" only if user already has one
  const hasPw = currentUser.has_password;
  document.getElementById('changePwTitle').textContent = hasPw ? 'Змінити пароль' : 'Встановити пароль';
  document.getElementById('changePwCurrentWrap').style.display = hasPw ? '' : 'none';
  document.getElementById('changePwCurrent').value = '';
  document.getElementById('changePwNew').value = '';

  document.getElementById('profileModal').classList.add('open');
}

function closeProfileModal() {
  document.getElementById('profileModal').classList.remove('open');
  document.getElementById('profileHeight').removeEventListener('input', _updateProfileBmi);
}

async function changePassword() {
  const current_password = document.getElementById('changePwCurrent').value;
  const new_password     = document.getElementById('changePwNew').value;
  if (new_password.length < 8) { showToast('⚠️ Пароль має містити мінімум 8 символів', 'var(--warn)'); return; }
  const btn = document.getElementById('btnChangePw');
  btn.disabled = true;
  try {
    const r = await fetch('/api/users/me/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: current_password || undefined, new_password }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { showToast('⚠️ ' + (data.error || 'Помилка'), 'var(--warn)'); return; }
    document.getElementById('changePwCurrent').value = '';
    document.getElementById('changePwNew').value = '';
    currentUser.has_password = true;
    document.getElementById('changePwTitle').textContent = 'Змінити пароль';
    document.getElementById('changePwCurrentWrap').style.display = '';
    showToast('✅ Пароль змінено');
  } catch { showToast('⚠️ Помилка мережі', 'var(--warn)'); }
  finally { btn.disabled = false; }
}

async function saveProfile() {
  const name          = document.getElementById('profileName').value.trim();
  const date_of_birth = document.getElementById('profileDob').value || null;
  const heightRaw     = document.getElementById('profileHeight').value;
  const height_cm     = heightRaw ? parseInt(heightRaw, 10) : null;

  const sex           = document.querySelector('input[name="profileSex"]:checked')?.value || null;
  const smoker        = document.getElementById('profileSmoker').checked;
  const diabetic      = document.getElementById('profileDiabetic').checked;
  const on_bp_meds    = document.getElementById('profileOnBpMeds').checked;

  showLoading('Збереження профілю…');
  try {
    const r = await fetch('/api/users/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name || null, date_of_birth, height_cm,
        sex, smoker, diabetic, on_bp_meds,
      }),
    });
    hideLoading();
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Помилка');
    const updated = await r.json();
    currentUser = { ...currentUser, ...updated };
    renderUserChip();
    closeProfileModal();
    renderTodaySummary();
    renderRiskCard();
    renderLabsCard();
    showToast('✅ Профіль збережено');
  } catch (err) {
    hideLoading();
    showToast('⚠️ ' + err.message, 'var(--warn)');
  }
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  const chip = document.getElementById('userChip');
  if (chip && !chip.contains(e.target)) {
    document.getElementById('userMenu')?.classList.remove('open');
  }
});

function applyTierRestrictions() {
  if (!currentUser || currentUser.effective_tier !== 'free') return;
  const FREE_MSG = 'Недоступно у безкоштовній версії';
  document.querySelectorAll('#page-export .export-card[onclick]').forEach(card => {
    card.removeAttribute('onclick');
    card.style.opacity = '0.4';
    card.style.cursor = 'not-allowed';
    card.style.filter = 'grayscale(0.6)';
    card.addEventListener('click', () => showToast('🔒 ' + FREE_MSG, 'var(--muted)'));
  });
  const importLabel = document.querySelector('#page-export label.btn-outline');
  if (importLabel) {
    importLabel.style.opacity = '0.4';
    importLabel.style.cursor = 'not-allowed';
    importLabel.style.pointerEvents = 'none';
    const inp = importLabel.querySelector('input');
    if (inp) inp.disabled = true;
    importLabel.addEventListener('click', e => {
      e.preventDefault();
      showToast('🔒 ' + FREE_MSG, 'var(--muted)');
    });
  }
}

