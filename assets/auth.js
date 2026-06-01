/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  auth.js — Mahiru AI Security & Authentication Layer        ║
 * ║  LangitDev © 2025                                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

const MahiruAuth = (() => {

  // ── Constants ──────────────────────────────────────────────────
  const MAX_LOGIN_ATTEMPTS = 5;
  const LOCKOUT_DURATION   = 15 * 60 * 1000;  // 15 minutes
  const SESSION_TTL        = 8 * 60 * 60 * 1000; // 8 hours
  const TOKEN_LENGTH       = 64;
  const SALT_ROUNDS        = 10000;
  const ADMIN_FLAG         = '__mahiru_admin__';

  // ── Storage keys ───────────────────────────────────────────────
  const K = {
    USERS:    'mhr_users_v2',
    SESSION:  'mhr_session_v2',
    ATTEMPTS: 'mhr_attempts',
    LOCKOUTS: 'mhr_lockouts',
    SETTINGS: 'mhr_settings',
    AUDIT:    'mhr_audit',
  };

  // ── Crypto helpers ─────────────────────────────────────────────
  function genToken(len = TOKEN_LENGTH) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2,'0')).join('');
  }

  function genSalt() { return genToken(16); }

  async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: SALT_ROUNDS, hash: 'SHA-256' },
      keyMaterial, 256
    );
    return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2,'0')).join('');
  }

  // ── Storage helpers ────────────────────────────────────────────
  const store = {
    get: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
    del: k => localStorage.removeItem(k),
  };

  // ── Audit log ──────────────────────────────────────────────────
  function audit(event, username = '', meta = {}) {
    const logs = store.get(K.AUDIT) || [];
    logs.unshift({ event, username, meta, ts: Date.now(), ua: navigator.userAgent.slice(0, 80) });
    if (logs.length > 500) logs.length = 500;
    store.set(K.AUDIT, logs);
  }

  // ── Lockout management ─────────────────────────────────────────
  function getLockout(username) {
    const lockouts = store.get(K.LOCKOUTS) || {};
    const l = lockouts[username];
    if (!l) return null;
    if (Date.now() > l.until) {
      delete lockouts[username];
      store.set(K.LOCKOUTS, lockouts);
      // also reset attempts
      const attempts = store.get(K.ATTEMPTS) || {};
      delete attempts[username];
      store.set(K.ATTEMPTS, attempts);
      return null;
    }
    return l;
  }

  function recordFailedAttempt(username) {
    const attempts = store.get(K.ATTEMPTS) || {};
    attempts[username] = (attempts[username] || 0) + 1;
    store.set(K.ATTEMPTS, attempts);

    if (attempts[username] >= MAX_LOGIN_ATTEMPTS) {
      const lockouts = store.get(K.LOCKOUTS) || {};
      lockouts[username] = { until: Date.now() + LOCKOUT_DURATION, count: attempts[username] };
      store.set(K.LOCKOUTS, lockouts);
      audit('ACCOUNT_LOCKED', username, { attempts: attempts[username] });
      return { locked: true, until: lockouts[username].until };
    }
    return { locked: false, remaining: MAX_LOGIN_ATTEMPTS - attempts[username] };
  }

  function clearAttempts(username) {
    const attempts = store.get(K.ATTEMPTS) || {};
    delete attempts[username];
    store.set(K.ATTEMPTS, attempts);
  }

  // ── Input sanitization ─────────────────────────────────────────
  function sanitize(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[<>&"'`]/g, c => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;','`':'&#96;' }[c])).trim();
  }

  function validateUsername(u) {
    if (!u || u.length < 3 || u.length > 20) return 'Username 3–20 karakter';
    if (!/^[a-zA-Z0-9_]+$/.test(u)) return 'Username hanya huruf, angka, dan _';
    return null;
  }

  function validatePassword(p) {
    if (!p || p.length < 8) return 'Password minimal 8 karakter';
    if (!/[A-Z]/.test(p)) return 'Harus ada huruf kapital';
    if (!/[0-9]/.test(p)) return 'Harus ada angka';
    return null;
  }

  // ── Session management ─────────────────────────────────────────
  function createSession(username, userData) {
    const token = genToken();
    const session = {
      token,
      username,
      name: userData.name,
      role: userData.role || 'user',
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL,
      fingerprint: getFingerprint(),
    };
    store.set(K.SESSION, session);
    audit('LOGIN', username);
    return session;
  }

  function getSession() {
    const s = store.get(K.SESSION);
    if (!s) return null;
    if (Date.now() > s.expiresAt) {
      store.del(K.SESSION);
      return null;
    }
    if (s.fingerprint !== getFingerprint()) {
      store.del(K.SESSION);
      audit('SESSION_FINGERPRINT_MISMATCH', s.username);
      return null;
    }
    return s;
  }

  function refreshSession() {
    const s = store.get(K.SESSION);
    if (!s) return;
    s.expiresAt = Date.now() + SESSION_TTL;
    store.set(K.SESSION, s);
  }

  function destroySession() {
    const s = store.get(K.SESSION);
    if (s) audit('LOGOUT', s.username);
    store.del(K.SESSION);
  }

  function getFingerprint() {
    const { language, platform, hardwareConcurrency, cookieEnabled } = navigator;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const raw = [language, platform, hardwareConcurrency, cookieEnabled, tz, screen.width, screen.height].join('|');
    // Simple hash
    let h = 0;
    for (let i = 0; i < raw.length; i++) { h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0; }
    return h.toString(36);
  }

  // ── User CRUD ──────────────────────────────────────────────────
  function getUsers() { return store.get(K.USERS) || {}; }
  function saveUsers(u) { store.set(K.USERS, u); }

  async function register(name, username, password) {
    name = sanitize(name);
    username = sanitize(username).toLowerCase();

    const uErr = validateUsername(username);
    if (uErr) return { ok: false, msg: uErr };
    const pErr = validatePassword(password);
    if (pErr) return { ok: false, msg: pErr };
    if (!name || name.length < 2) return { ok: false, msg: 'Nama minimal 2 karakter' };

    const users = getUsers();
    if (users[username]) return { ok: false, msg: 'Username sudah digunakan' };

    const salt = genSalt();
    const hash = await hashPassword(password, salt);

    const isFirstUser = Object.keys(users).length === 0;

    users[username] = {
      name,
      hash,
      salt,
      role: isFirstUser ? 'admin' : 'user',
      createdAt: Date.now(),
      lastLogin: null,
      msgCount: 0,
      banned: false,
    };
    saveUsers(users);
    audit('REGISTER', username, { role: users[username].role });
    return { ok: true, msg: isFirstUser ? 'Akun admin berhasil dibuat!' : 'Akun berhasil dibuat!' };
  }

  async function login(username, password) {
    username = sanitize(username).toLowerCase();
    if (!username || !password) return { ok: false, msg: 'Isi semua field' };

    const lockout = getLockout(username);
    if (lockout) {
      const mins = Math.ceil((lockout.until - Date.now()) / 60000);
      return { ok: false, msg: `Akun dikunci. Coba lagi dalam ${mins} menit.`, locked: true };
    }

    const users = getUsers();
    const user = users[username];
    if (!user) {
      recordFailedAttempt(username);
      return { ok: false, msg: 'Username atau password salah' };
    }

    if (user.banned) {
      audit('LOGIN_BANNED', username);
      return { ok: false, msg: 'Akun ini telah dinonaktifkan.' };
    }

    const hash = await hashPassword(password, user.salt);
    if (hash !== user.hash) {
      const result = recordFailedAttempt(username);
      audit('LOGIN_FAIL', username);
      if (result.locked) return { ok: false, msg: `Terlalu banyak percobaan. Akun dikunci 15 menit.`, locked: true };
      return { ok: false, msg: `Password salah. Sisa percobaan: ${result.remaining}` };
    }

    clearAttempts(username);
    user.lastLogin = Date.now();
    saveUsers(users);

    const session = createSession(username, user);
    return { ok: true, session };
  }

  // ── Admin helpers ──────────────────────────────────────────────
  function requireAdmin() {
    const s = getSession();
    if (!s || s.role !== 'admin') {
      window.location.href = 'index.html';
      return false;
    }
    return true;
  }

  function requireAuth() {
    const s = getSession();
    if (!s) { window.location.href = 'index.html'; return false; }
    refreshSession();
    return s;
  }

  // ── Rate limit for messages ────────────────────────────────────
  function checkRateLimit(username) {
    const settings = store.get(K.SETTINGS) || {};
    const limit = settings.msgLimitPerHour || 50;
    const key = `mhr_rate_${username}`;
    const data = store.get(key) || { count: 0, windowStart: Date.now() };

    if (Date.now() - data.windowStart > 3600000) {
      store.set(key, { count: 1, windowStart: Date.now() });
      return { ok: true, remaining: limit - 1 };
    }

    if (data.count >= limit) {
      const resetIn = Math.ceil((data.windowStart + 3600000 - Date.now()) / 60000);
      return { ok: false, msg: `Limit pesan tercapai (${limit}/jam). Reset dalam ${resetIn} menit.` };
    }

    data.count++;
    store.set(key, data);

    // Update total user msg count
    const users = getUsers();
    if (users[username]) {
      users[username].msgCount = (users[username].msgCount || 0) + 1;
      saveUsers(users);
    }

    return { ok: true, remaining: limit - data.count };
  }

  // ── Public API ─────────────────────────────────────────────────
  return {
    register,
    login,
    logout: destroySession,
    getSession,
    requireAuth,
    requireAdmin,
    checkRateLimit,
    sanitize,
    getUsers,
    saveUsers,
    getAudit: () => store.get(K.AUDIT) || [],
    getSettings: () => store.get(K.SETTINGS) || {},
    saveSettings: s => store.set(K.SETTINGS, s),
    K,
  };

})();
