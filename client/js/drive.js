// ── DRIVE BACKUP ────────────────────────────────────────────────────────────
async function openDriveModal(showSuccess = false) {
  document.getElementById('driveModal').classList.add('open');
  const banner = document.getElementById('driveStatusBanner');
  banner.style.display = 'none';
  document.getElementById('driveNotConnected').style.display = 'none';
  document.getElementById('driveConnected').style.display = 'none';
  document.getElementById('driveFileList').innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">Завантаження…</div>';

  try {
    const r = await fetch('/api/backup/drive/status');
    const { connected } = await r.json();
    if (connected) {
      if (showSuccess) {
        banner.style.cssText = 'display:block;background:rgba(52,211,153,.12);color:#34d399;border:1px solid rgba(52,211,153,.3);border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:14px';
        banner.textContent = '✅ Google Drive успішно підключено!';
      }
      document.getElementById('driveConnected').style.display = 'block';
      loadDriveFileList();
    } else {
      document.getElementById('driveNotConnected').style.display = 'block';
    }
  } catch {
    document.getElementById('driveNotConnected').style.display = 'block';
  }
}

function closeDriveModal() {
  document.getElementById('driveModal').classList.remove('open');
}

function connectDrive() {
  window.location.href = '/api/auth/google/drive';
}

async function disconnectDrive() {
  if (!confirm('Відключити Google Drive? Файли на Drive не будуть видалені.')) return;
  await fetch('/api/backup/drive', { method: 'DELETE' });
  document.getElementById('driveConnected').style.display = 'none';
  document.getElementById('driveNotConnected').style.display = 'block';
}

async function runDriveBackup() {
  const btn = document.getElementById('btnDriveBackup');
  btn.disabled = true;
  btn.textContent = '⏳ Збереження…';
  try {
    const r = await fetch('/api/backup/drive', { method: 'POST' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Помилка');
    _driveShowBanner(`✅ Збережено: ${data.filename} (${data.count} записів)`, 'success');
    loadDriveFileList();
  } catch (err) {
    _driveShowBanner('❌ ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '☁️ Створити резервну копію';
  }
}

async function loadDriveFileList() {
  const box = document.getElementById('driveFileList');
  box.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">Завантаження…</div>';
  try {
    const r = await fetch('/api/backup/drive/list');
    const { files } = await r.json();
    if (!files?.length) {
      box.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">Резервних копій ще немає</div>';
      return;
    }
    box.innerHTML = files.map(f => {
      const date = f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString('uk-UA') : '';
      const kb   = f.size ? Math.round(f.size / 1024) + ' КБ' : '';
      return `<div class="drive-file-item">
        <div>
          <div class="drive-file-name">${escHtml(f.name)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${date}${kb ? ' · ' + kb : ''}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn-restore" data-id="${escHtml(f.id)}" data-name="${escHtml(f.name)}" onclick="restoreFromDrive(this.dataset.id,this.dataset.name)">Відновити</button>
          <button class="btn-outline" style="padding:6px 10px;font-size:12px;color:var(--warn);border-color:var(--warn)" data-id="${escHtml(f.id)}" data-name="${escHtml(f.name)}" onclick="deleteFromDrive(this.dataset.id,this.dataset.name)">🗑</button>
        </div>
      </div>`;
    }).join('');
  } catch {
    box.innerHTML = '<div style="color:var(--warn);font-size:13px;padding:8px 0">Помилка завантаження списку</div>';
  }
}

async function deleteFromDrive(fileId, filename) {
  if (!confirm(`Видалити файл "${filename}" з Google Drive?\nЦю дію неможливо скасувати.`)) return;
  try {
    const r = await fetch(`/api/backup/drive/file/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error((await r.json()).error || 'Помилка');
    showToast('🗑 Файл видалено з Drive');
    loadDriveFileList();
  } catch (err) {
    showToast('❌ ' + err.message, 'var(--warn)');
  }
}

async function restoreFromDrive(fileId, filename) {
  if (!confirm(`Відновити дані з файлу ${filename}?\nНаявні записи НЕ будуть видалені — додадуться лише нові дати.`)) return;
  showLoading('Відновлення з Drive…');
  try {
    const r = await fetch('/api/backup/drive/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Помилка');
    await fetchEntries();
    renderHistory();
    renderTodaySummary();
    closeDriveModal();
    showToast(`✅ Відновлено: +${data.imported} нових, ${data.skipped} пропущено`);
  } catch (err) {
    showToast('❌ ' + err.message, 'var(--warn)');
  } finally {
    hideLoading();
  }
}

function _driveShowBanner(msg, type) {
  const el = document.getElementById('driveStatusBanner');
  el.textContent = msg;
  el.style.display = 'block';
  el.style.background = type === 'success' ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.12)';
  el.style.border = `1px solid ${type === 'success' ? 'rgba(34,197,94,.4)' : 'rgba(239,68,68,.4)'}`;
  el.style.color = type === 'success' ? '#22c55e' : '#ef4444';
}

