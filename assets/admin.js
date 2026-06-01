/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  admin.js — Mahiru AI Admin Dashboard (FINISHED)            ║
 * ║  Handles: users, audit log, settings, stats, security        ║
 * ║  LangitDev © 2025                                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

// ── Toast (inline fallback if app.js not loaded first) ────────────
function toast(msg, type = 'error') {
  if (window.Toast) { window.Toast[type]?.(msg) || window.Toast.info(msg); return; }
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  setTimeout(() => el.classList.remove('show'), 3400);
}

// ── Init ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!MahiruAuth.requireAdmin()) return;

  const session = MahiruAuth.getSession();
  const topbarUser = document.getElementById('topbarUser');
  if (topbarUser) topbarUser.textContent = session.name;

  _loadAdminSettings();
  refreshAll();

  // Auto-refresh overview stats every 10s
  setInterval(() => {
    if (document.getElementById('tab-overview')?.classList.contains('active')) {
      renderOverview();
    }
  }, 10000);
});

// ── Tab routing ───────────────────────────────────────────────────
function showTab(name) {
  // Hide all panels
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item[data-tab]').forEach(n => n.classList.remove('active'));

  const panel = document.getElementById(`tab-${name}`);
  if (panel) panel.classList.add('active');

  const navItem = document.querySelector(`.nav-item[data-tab="${name}"]`);
  if (navItem) navItem.classList.add('active');

  const titles = { overview: 'Overview', users: 'Manajemen User', audit: 'Audit Log', settings: 'Konfigurasi' };
  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle) pageTitle.textContent = titles[name] || name;

  // Lazy render
  if (name === 'users')    renderUsers();
  if (name === 'audit')    renderAudit();
  if (name === 'overview') renderOverview();
  if (name === 'settings') _loadAdminSettings();
}

// ── Refresh all ───────────────────────────────────────────────────
function refreshAll() {
  renderOverview();
  renderUsers();
  renderAudit();
}

// ── Overview tab ──────────────────────────────────────────────────
function renderOverview() {
  const users = MahiruAuth.getUsers();
  const audit = MahiruAuth.getAudit();
  const userList = Object.values(users);

  const totalUsers   = userList.length;
  const activeUsers  = userList.filter(u => !u.banned).length;
  const bannedUsers  = userList.filter(u => u.banned).length;
  const totalMsgs    = userList.reduce((s, u) => s + (u.msgCount || 0), 0);
  const totalAudit   = audit.length;
  const adminCount   = userList.filter(u => u.role === 'admin').length;

  _setText('statUsers',    totalUsers);
  _setText('statMessages', totalMsgs.toLocaleString('id-ID'));
  _setText('statActive',   activeUsers);
  _setText('statAudit',    totalAudit);

  // Update stat sub labels with extra info
  const statUsersSub = document.querySelector('#statUsers')?.closest('.stat-card')?.querySelector('.stat-sub');
  if (statUsersSub) statUsersSub.textContent = `${adminCount} admin · ${bannedUsers} diblokir`;

  // Recent 10 audit events
  const container = document.getElementById('recentAudit');
  if (!container) return;

  const recent = audit.slice(0, 10);
  if (recent.length === 0) {
    container.innerHTML = '<div class="empty-table">Belum ada aktivitas</div>';
    return;
  }

  container.innerHTML = recent.map(entry => _auditItemHtml(entry)).join('');
}

// ── Users tab ─────────────────────────────────────────────────────
let _usersCache = [];
let _currentUserEdit = null;

function renderUsers(filter = '') {
  const users = MahiruAuth.getUsers();
  _usersCache = Object.entries(users).map(([username, data]) => ({ username, ...data }));

  filterUsers(filter || document.getElementById('userSearch')?.value || '');
}

function filterUsers(query) {
  const q = query.toLowerCase().trim();
  const filtered = q
    ? _usersCache.filter(u => u.username.includes(q) || u.name.toLowerCase().includes(q))
    : _usersCache;

  const tbody = document.getElementById('usersTable');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-table">Tidak ada user ditemukan</td></tr>';
    return;
  }

  // Sort: admin first, then by createdAt desc
  const sorted = [...filtered].sort((a, b) => {
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  const session = MahiruAuth.getSession();

  tbody.innerHTML = sorted.map(u => {
    const isSelf = u.username === session?.username;
    const avatarBg = u.role === 'admin'
      ? 'background:linear-gradient(135deg,#f0b429,#d97706);color:#0a0800'
      : 'background:var(--surface3);color:var(--text2)';

    const roleHtml = u.role === 'admin'
      ? '<span class="badge badge-gold">Admin</span>'
      : '<span class="badge badge-gray">User</span>';

    const statusHtml = u.banned
      ? '<span class="status-dot banned"></span>Diblokir'
      : '<span class="status-dot active"></span>Aktif';

    const lastLogin = u.lastLogin
      ? _formatRelative(u.lastLogin)
      : '<span style="color:var(--muted)">—</span>';

    const joinDate = u.createdAt
      ? new Date(u.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
      : '—';

    // Build action buttons
    let actionHtml = '';
    if (isSelf) {
      actionHtml = '<span style="font-size:0.72rem;color:var(--muted)">Akun kamu</span>';
    } else {
      const adminBtn = u.role !== 'admin'
        ? `<button class="btn-secondary" style="padding:4px 10px;font-size:0.75rem" onclick="toggleAdmin('${u.username}')">🛡 Jadikan Admin</button>`
        : `<button class="btn-secondary" style="padding:4px 10px;font-size:0.75rem" onclick="toggleAdmin('${u.username}')">👤 Cabut Admin</button>`;

      const banBtn = u.banned
        ? `<button class="btn-secondary" style="padding:4px 10px;font-size:0.75rem" onclick="toggleBan('${u.username}')">✓ Aktifkan</button>`
        : `<button class="btn-danger" style="padding:4px 10px;font-size:0.75rem" onclick="toggleBan('${u.username}')">🚫 Blokir</button>`;

      actionHtml = `
        <div class="row-actions">
          ${adminBtn}
          ${banBtn}
          <button class="btn-secondary" style="padding:4px 10px;font-size:0.75rem" onclick="editUser('${u.username}')">✏️ Edit</button>
          <button class="btn-danger" style="padding:4px 10px;font-size:0.75rem" onclick="resetUserPassword('${u.username}')">🔑 Reset PW</button>
          <button class="btn-danger" style="padding:4px 10px;font-size:0.75rem" onclick="resetUserChats('${u.username}')">🗑 Chat</button>
        </div>`;
    }

    return `
      <tr>
        <td>
          <span class="user-row-avatar" style="${avatarBg}">${u.name.charAt(0).toUpperCase()}</span>
          <strong>${MahiruAuth.sanitize(u.name)}</strong>
          <div style="font-size:0.72rem;color:var(--muted);margin-left:36px">@${MahiruAuth.sanitize(u.username)}</div>
        </td>
        <td>${roleHtml}</td>
        <td>${(u.msgCount || 0).toLocaleString('id-ID')}</td>
        <td style="font-size:0.78rem;color:var(--text2)">${joinDate}</td>
        <td style="font-size:0.78rem;color:var(--text2)">${lastLogin}</td>
        <td style="font-size:0.82rem">${statusHtml}</td>
        <td>${actionHtml}</td>
      </tr>`;
  }).join('');
}

function toggleBan(username) {
  const users = MahiruAuth.getUsers();
  if (!users[username]) return;

  const isBanned = users[username].banned;
  if (!isBanned && !confirm(`Blokir user @${username}? User tidak akan bisa login.`)) return;

  users[username].banned = !isBanned;
  MahiruAuth.saveUsers(users);

  // Log the action
  const auditEvent = isBanned ? 'USER_UNBANNED' : 'USER_BANNED';
  _addAudit(auditEvent, username, { by: MahiruAuth.getSession()?.username });

  toast(isBanned ? `@${username} diaktifkan kembali` : `@${username} diblokir`, isBanned ? 'success' : 'warn');
  renderUsers();
  renderOverview();
}

function toggleAdmin(username) {
  const users = MahiruAuth.getUsers();
  if (!users[username]) return;

  const isAdmin = users[username].role === 'admin';
  if (!isAdmin && !confirm(`Jadikan @${username} sebagai admin? Akses penuh ke dashboard.`)) return;
  if (isAdmin && !confirm(`Cabut hak admin dari @${username}?`)) return;

  users[username].role = isAdmin ? 'user' : 'admin';
  MahiruAuth.saveUsers(users);

  _addAudit(isAdmin ? 'ADMIN_REMOVED' : 'ADMIN_GRANTED', username, { by: MahiruAuth.getSession()?.username });
  toast(`Role @${username} diperbarui → ${users[username].role}`, 'success');
  renderUsers();
  renderOverview();
}

function resetUserChats(username) {
  if (!confirm(`Hapus semua chat @${username}? Pesan tidak bisa dikembalikan.`)) return;
  try {
    localStorage.removeItem(`mhr_chats_v2_${username}`);
    const users = MahiruAuth.getUsers();
    if (users[username]) {
      users[username].msgCount = 0;
      MahiruAuth.saveUsers(users);
    }
    _addAudit('CHAT_DELETED', username, { by: MahiruAuth.getSession()?.username });
    toast(`Chat @${username} dihapus`, 'success');
    renderUsers();
    renderOverview();
  } catch (e) {
    toast('Gagal menghapus chat: ' + e.message);
  }
}

// ── Edit User ─────────────────────────────────────────────────────
function editUser(username) {
  const users = MahiruAuth.getUsers();
  const user = users[username];
  if (!user) return;

  _currentUserEdit = username;

  const newName = prompt(`Edit nama untuk @${username}:`, user.name);
  if (newName === null) return; // Cancelled

  const sanitized = MahiruAuth.sanitize(newName);
  if (!sanitized || sanitized.length < 2) {
    toast('Nama minimal 2 karakter', 'error');
    return;
  }

  users[username].name = sanitized;
  MahiruAuth.saveUsers(users);
  _addAudit('USER_EDITED', username, { by: MahiruAuth.getSession()?.username, newName: sanitized });
  toast(`Nama @${username} diperbarui`, 'success');
  renderUsers();
}

// ── Reset Password User ───────────────────────────────────────────
async function resetUserPassword(username) {
  const users = MahiruAuth.getUsers();
  if (!users[username]) return;

  const newPass = prompt(`Reset password untuk @${username}\nMasukkan password baru (min 8 karakter, huruf kapital + angka):`);
  if (!newPass) return;

  // Validate password
  if (newPass.length < 8) { toast('Password minimal 8 karakter', 'error'); return; }
  if (!/[A-Z]/.test(newPass)) { toast('Harus ada huruf kapital', 'error'); return; }
  if (!/[0-9]/.test(newPass)) { toast('Harus ada angka', 'error'); return; }

  if (!confirm(`Yakin reset password @${username}?`)) return;

  const salt = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const hash = await _hashPassword(newPass, salt);

  users[username].hash = hash;
  users[username].salt = salt;
  MahiruAuth.saveUsers(users);

  _addAudit('PASSWORD_RESET', username, { by: MahiruAuth.getSession()?.username });
  toast(`Password @${username} direset ✓`, 'success');
}

// ── Audit tab ─────────────────────────────────────────────────────
let _auditPage = 0;
const _auditPerPage = 20;

function renderAudit() {
  const container = document.getElementById('auditLog');
  if (!container) return;

  const filter = document.getElementById('auditFilter')?.value || '';
  let logs = MahiruAuth.getAudit();
  if (filter) logs = logs.filter(l => l.event === filter);

  if (logs.length === 0) {
    container.innerHTML = '<div class="empty-table">Tidak ada log ditemukan</div>';
    return;
  }

  // Pagination
  const totalPages = Math.ceil(logs.length / _auditPerPage);
  const start = _auditPage * _auditPerPage;
  const pageLogs = logs.slice(start, start + _auditPerPage);

  let html = pageLogs.map(entry => _auditItemHtml(entry)).join('');

  // Pagination controls
  if (totalPages > 1) {
    html += `
      <div style="display:flex;justify-content:center;align-items:center;gap:8px;padding:16px;border-top:1px solid var(--border2)">
        <button class="btn-secondary" style="padding:6px 12px;font-size:0.78rem" onclick="changeAuditPage(-1)" ${_auditPage <= 0 ? 'disabled' : ''}>← Prev</button>
        <span style="font-size:0.78rem;color:var(--muted)">Halaman ${_auditPage + 1} dari ${totalPages}</span>
        <button class="btn-secondary" style="padding:6px 12px;font-size:0.78rem" onclick="changeAuditPage(1)" ${_auditPage >= totalPages - 1 ? 'disabled' : ''}>Next →</button>
      </div>`;
  }

  container.innerHTML = html;
}

function changeAuditPage(delta) {
  _auditPage += delta;
  if (_auditPage < 0) _auditPage = 0;
  renderAudit();
}

function _auditItemHtml(entry) {
  const eventClass = {
    'LOGIN':           'audit-login',
    'LOGOUT':          'audit-logout',
    'REGISTER':        'audit-register',
    'LOGIN_FAIL':      'audit-fail',
    'ACCOUNT_LOCKED':  'audit-locked',
    'LOGIN_BANNED':    'audit-locked',
    'USER_BANNED':     'audit-locked',
    'USER_UNBANNED':   'audit-login',
    'ADMIN_GRANTED':   'audit-register',
    'ADMIN_REMOVED':   'audit-logout',
    'CHAT_DELETED':    'audit-other',
    'USER_EDITED':     'audit-other',
    'PASSWORD_RESET':  'audit-fail',
    'SETTINGS_CHANGED':'audit-other',
    'DATA_EXPORTED':   'audit-other',
    'ALL_CHATS_CLEARED':'audit-locked',
  }[entry.event] || 'audit-other';

  const eventLabel = {
    'LOGIN':                  'LOGIN',
    'LOGOUT':                 'LOGOUT',
    'REGISTER':               'DAFTAR',
    'LOGIN_FAIL':             'GAGAL',
    'ACCOUNT_LOCKED':         'DIKUNCI',
    'LOGIN_BANNED':           'DIBLOKIR',
    'USER_BANNED':            'BLOKIR',
    'USER_UNBANNED':          'AKTIF',
    'ADMIN_GRANTED':          '+ADMIN',
    'ADMIN_REMOVED':          '-ADMIN',
    'CHAT_DELETED':           'HAPUS CHAT',
    'USER_EDITED':            'EDIT',
    'PASSWORD_RESET':         'RESET PW',
    'SETTINGS_CHANGED':       'SETTINGS',
    'DATA_EXPORTED':          'EXPORT',
    'ALL_CHATS_CLEARED':      'HAPUS ALL',
    'SESSION_FINGERPRINT_MISMATCH': 'SEC',
  }[entry.event] || entry.event;

  const metaStr = entry.meta && Object.keys(entry.meta).length > 0
    ? ' — ' + Object.entries(entry.meta).map(([k, v]) => `${k}: ${v}`).join(', ')
    : '';

  return `
    <div class="audit-item">
      <span class="audit-event ${eventClass}">${eventLabel}</span>
      <div class="audit-meta">
        <div class="audit-user">@${MahiruAuth.sanitize(entry.username || '?')}${metaStr}</div>
        <div class="audit-time">${_formatDateTime(entry.ts)} · ${_formatRelative(entry.ts)}</div>
      </div>
    </div>`;
}

function clearAudit() {
  if (!confirm('Hapus semua audit log? Tindakan ini tidak bisa dibatalkan.')) return;
  try {
    localStorage.removeItem(MahiruAuth.K.AUDIT);
    _auditPage = 0;
    toast('Audit log dihapus', 'success');
    renderAudit();
    renderOverview();
  } catch (e) {
    toast('Gagal: ' + e.message);
  }
}

// ── Settings tab ──────────────────────────────────────────────────
function _loadAdminSettings() {
  const settings = MahiruAuth.getSettings();

  const gk  = document.getElementById('adminGeminiKey');
  const xk  = document.getElementById('adminGrokKey');
  const lim = document.getElementById('msgLimitPerHour');
  const reg = document.getElementById('allowRegister');

  if (gk)  gk.value  = settings.geminiKey || '';
  if (xk)  xk.value  = settings.grokKey   || '';
  if (lim) lim.value = settings.msgLimitPerHour || 50;
  if (reg) reg.value = settings.allowRegister === false ? '0' : '1';
}

function saveAdminSettings() {
  const settings = MahiruAuth.getSettings();

  const gk  = document.getElementById('adminGeminiKey')?.value.trim();
  const xk  = document.getElementById('adminGrokKey')?.value.trim();
  const lim = parseInt(document.getElementById('msgLimitPerHour')?.value) || 50;
  const reg = document.getElementById('allowRegister')?.value;

  if (gk) settings.geminiKey = gk;
  if (xk) settings.grokKey   = xk;
  settings.msgLimitPerHour = Math.max(1, Math.min(500, lim));
  settings.allowRegister   = reg !== '0';

  MahiruAuth.saveSettings(settings);
  _addAudit('SETTINGS_CHANGED', MahiruAuth.getSession()?.username, {
    msgLimit: settings.msgLimitPerHour,
    allowRegister: settings.allowRegister
  });
  toast('Settings disimpan ✓', 'success');
}

// ── Danger zone ───────────────────────────────────────────────────
function confirmClearAll() {
  if (!confirm('⚠ HAPUS semua data chat semua user? Tindakan ini tidak bisa dibatalkan!')) return;
  if (!confirm('YAKIN BANGET? Ini akan menghapus SEMUA percakapan dari SEMUA user.')) return;

  let deleted = 0;
  const users = MahiruAuth.getUsers();
  Object.keys(users).forEach(username => {
    localStorage.removeItem(`mhr_chats_v2_${username}`);
    users[username].msgCount = 0;
    deleted++;
  });
  MahiruAuth.saveUsers(users);

  _addAudit('ALL_CHATS_CLEARED', MahiruAuth.getSession()?.username, { usersAffected: deleted });
  toast(`Data chat ${deleted} user dihapus`, 'success');
  renderOverview();
  renderUsers();
}

function exportData() {
  const users = MahiruAuth.getUsers();
  const audit = MahiruAuth.getAudit();
  const settings = MahiruAuth.getSettings();

  const exportObj = {
    exportedAt: new Date().toISOString(),
    exportedBy: MahiruAuth.getSession()?.username,
    version: '1.0',
    summary: {
      totalUsers: Object.keys(users).length,
      totalAuditLogs: audit.length,
      totalMessages: Object.values(users).reduce((s, u) => s + (u.msgCount || 0), 0),
    },
    settings: {
      msgLimitPerHour: settings.msgLimitPerHour,
      allowRegister: settings.allowRegister,
      hasGeminiKey: !!settings.geminiKey,
      hasGrokKey: !!settings.grokKey,
    },
    users: Object.entries(users).map(([username, data]) => ({
      username,
      name:      data.name,
      role:      data.role,
      createdAt: data.createdAt ? new Date(data.createdAt).toISOString() : null,
      lastLogin: data.lastLogin ? new Date(data.lastLogin).toISOString() : null,
      msgCount:  data.msgCount || 0,
      banned:    data.banned || false,
      // Never export hash/salt
    })),
    auditCount: audit.length,
  };

  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `mahiru-export-${new Date().toISOString().slice(0,10)}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);

  _addAudit('DATA_EXPORTED', MahiruAuth.getSession()?.username, { usersCount: exportObj.summary.totalUsers });
  toast('Data diekspor ✓', 'success');
}

// ── Internal helpers ──────────────────────────────────────────────
function _addAudit(event, username, meta = {}) {
  const logs = JSON.parse(localStorage.getItem(MahiruAuth.K.AUDIT) || '[]');
  logs.unshift({
    event,
    username: username || '',
    meta,
    ts: Date.now(),
    ua: navigator.userAgent.slice(0, 80)
  });
  if (logs.length > 500) logs.length = 500;
  localStorage.setItem(MahiruAuth.K.AUDIT, JSON.stringify(logs));
}

async function _hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 10000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
}

// ── Helpers ───────────────────────────────────────────────────────
function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _formatRelative(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60000)    return 'Baru saja';
  if (diff < 3600000)  return Math.floor(diff / 60000) + ' mnt lalu';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' jam lalu';
  if (diff < 604800000) return Math.floor(diff / 86400000) + ' hari lalu';
  return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function _formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('id-ID', {
    day:    'numeric',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ── Expose globals needed by HTML ─────────────────────────────────
window.showTab           = showTab;
window.renderAudit       = renderAudit;
window.filterUsers       = filterUsers;
window.toggleBan         = toggleBan;
window.toggleAdmin       = toggleAdmin;
window.resetUserChats    = resetUserChats;
window.editUser          = editUser;
window.resetUserPassword = resetUserPassword;
window.clearAudit        = clearAudit;
window.changeAuditPage   = changeAuditPage;
window.saveAdminSettings = saveAdminSettings;
window.confirmClearAll   = confirmClearAll;
window.exportData        = exportData;
window.handleLogout      = () => { MahiruAuth.logout(); window.location.href = 'index.html'; };
window.togglePwSettings  = (id, btn) => {
  const input = document.getElementById(id);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? '👁' : '🙈';
};
