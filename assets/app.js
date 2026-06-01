/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  app.js — Mahiru AI Core Logic & Auth Bridge                ║
 * ║  Handles: UI init, session, toast, theme, shared utils      ║
 * ║  LangitDev © 2025                                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

// ── Toast notification system ─────────────────────────────────────
const Toast = (() => {
  let _timer = null;

  function show(msg, type = 'info', duration = 3200) {
    const el = document.getElementById('toast');
    if (!el) return;

    el.textContent = msg;
    el.className = `toast toast-${type} show`;

    clearTimeout(_timer);
    _timer = setTimeout(() => {
      el.className = el.className.replace(' show', '');
    }, duration);
  }

  return {
    info:    (msg, ms) => show(msg, 'info', ms),
    success: (msg, ms) => show(msg, 'success', ms),
    error:   (msg, ms) => show(msg, 'error', ms || 4000),
    warn:    (msg, ms) => show(msg, 'warn', ms),
  };
})();


// ── Shared UI helpers ─────────────────────────────────────────────
function togglePwSettings(id, btn) {
  const input = document.getElementById(id);
  if (!input) return;
  const isPass = input.type === 'password';
  input.type = isPass ? 'text' : 'password';
  btn.textContent = isPass ? '🙈' : '👁';
}

function handleLogout() {
  MahiruAuth.logout();
  Toast.info('Sampai jumpa!');
  setTimeout(() => { window.location.href = 'index.html'; }, 600);
}

// ── Settings panel ────────────────────────────────────────────────
function openSettings() {
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay) return;

  // Pre-fill keys from saved settings
  const settings = MahiruAuth.getSettings();
  const gk = document.getElementById('geminiKey');
  const xk = document.getElementById('grokKey');
  if (gk) gk.value = settings.geminiKey || '';
  if (xk) xk.value = settings.grokKey || '';

  // Update rate limit bar
  updateRateBar();

  overlay.classList.add('open');
}

function closeSettings() {
  const overlay = document.getElementById('settingsOverlay');
  if (overlay) overlay.classList.remove('open');
}

function closeSettingsOnOverlay(e) {
  if (e.target === e.currentTarget) closeSettings();
}

function saveSettings() {
  const settings = MahiruAuth.getSettings();
  const gk = document.getElementById('geminiKey');
  const xk = document.getElementById('grokKey');

  if (gk && gk.value.trim()) settings.geminiKey = gk.value.trim();
  if (xk && xk.value.trim()) settings.grokKey = xk.value.trim();

  MahiruAuth.saveSettings(settings);
  Toast.success('Settings disimpan ✓');
  closeSettings();
}

function updateRateBar() {
  const session = MahiruAuth.getSession();
  if (!session) return;

  const settings = MahiruAuth.getSettings();
  const limit = settings.msgLimitPerHour || 50;
  const key = `mhr_rate_${session.username}`;
  let data = null;
  try { data = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}

  const used = data && (Date.now() - data.windowStart < 3600000) ? data.count : 0;
  const pct = Math.min(100, Math.round((used / limit) * 100));

  const label = document.getElementById('rateLabel');
  const fill  = document.getElementById('rateBarFill');
  if (label) label.textContent = `${used} / ${limit} pesan dikirim jam ini`;
  if (fill) {
    fill.style.width = pct + '%';
    fill.style.background = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--gold)' : 'var(--gold)';
  }
}


// ── Model dropdown (chat page) ────────────────────────────────────
function toggleModelDropdown() {
  const btn = document.getElementById('modelSelectorBtn');
  const dd  = document.getElementById('modelDropdown');
  if (!btn || !dd) return;

  const isOpen = dd.classList.contains('open');
  dd.classList.toggle('open', !isOpen);
  btn.classList.toggle('open', !isOpen);

  if (!isOpen) renderModelDropdown();
}

function closeModelDropdown() {
  const btn = document.getElementById('modelSelectorBtn');
  const dd  = document.getElementById('modelDropdown');
  if (btn) btn.classList.remove('open');
  if (dd)  dd.classList.remove('open');
}

function renderModelDropdown() {
  const dd = document.getElementById('modelDropdown');
  if (!dd) return;

  const BADGE_COLORS = {
    'SPECIAL': 'background:rgba(240,180,41,0.15);color:#f0b429;',
    'FAST':    'background:rgba(66,133,244,0.15);color:#4285f4;',
    'PRO':     'background:rgba(66,133,244,0.15);color:#4285f4;',
    'FREE':    'background:rgba(74,222,128,0.15);color:#4ade80;',
    'BETA':    'background:rgba(168,85,247,0.15);color:#a855f7;',
  };

  const currentModel = window._mahiruCurrentModel || 'mahiru-x-ultra';

  // Group by provider
  const groups = [
    { label: 'Mahiru', ids: ['mahiru-x-ultra'] },
    { label: 'Google Gemini', ids: ['gemini-2.0-flash','gemini-1.5-pro','gemini-1.5-flash'] },
    { label: 'xAI Grok', ids: ['grok-3-mini','grok-beta'] },
  ];

  let html = '';
  groups.forEach(g => {
    html += `<div class="model-picker-section">${g.label}</div>`;
    g.ids.forEach(id => {
      const m = MahiruAPI.MODELS.find(x => x.id === id);
      if (!m) return;
      const badgeStyle = BADGE_COLORS[m.badge] || '';
      const isActive = id === currentModel;
      html += `
        <button class="model-option ${isActive ? 'active' : ''}" onclick="selectModel('${id}')">
          <div class="model-option-left">
            <span class="model-option-icon" style="color:${m.color}">${m.icon}</span>
            <div>
              <div class="model-option-name">${m.label.replace(/^✦\s*/,'')}</div>
              <div class="model-option-desc">${m.desc}</div>
            </div>
          </div>
          <span class="model-badge" style="${badgeStyle}">${m.badge}</span>
        </button>`;
    });
  });

  dd.innerHTML = html;
}

function selectModel(id) {
  window._mahiruCurrentModel = id;
  const m = MahiruAPI.MODELS.find(x => x.id === id);
  if (!m) return;

  const label = document.getElementById('modelLabel');
  const icon  = document.getElementById('modelIcon');
  if (label) label.textContent = m.label;
  if (icon)  { icon.textContent = m.icon; icon.style.color = m.color; }

  // Persist selection
  try { localStorage.setItem('mhr_model', id); } catch {}

  closeModelDropdown();
  Toast.info(`Model: ${m.label}`, 1800);
}


// ── Suggestions for empty state ───────────────────────────────────
const SUGGESTIONS = [
  { icon: '💻', title: 'Bantu coding', desc: 'Debug, refactor, atau buat fitur baru' },
  { icon: '✍️', title: 'Tulis konten', desc: 'Artikel, caption, atau copywriting' },
  { icon: '🔍', title: 'Analisis data', desc: 'Jelaskan, rangkum, atau interpretasi' },
  { icon: '🌐', title: 'Terjemahan', desc: 'Terjemahkan teks ke bahasa apa pun' },
];

function renderSuggestions() {
  const grid = document.getElementById('suggestionGrid');
  if (!grid) return;
  grid.innerHTML = SUGGESTIONS.map(s => `
    <button class="suggestion-card" onclick="useSuggestion('${s.title}')">
      <div class="s-icon">${s.icon}</div>
      <div class="s-title">${s.title}</div>
      <div class="s-desc">${s.desc}</div>
    </button>
  `).join('');
}

function useSuggestion(title) {
  const input = document.getElementById('chatInput');
  if (!input) return;
  const prompts = {
    'Bantu coding':    'Tolong bantu saya dengan kode berikut: ',
    'Tulis konten':    'Tolong buatkan konten tentang: ',
    'Analisis data':   'Tolong analisis teks berikut: ',
    'Terjemahan':      'Tolong terjemahkan ke bahasa Inggris: ',
  };
  input.value = prompts[title] || title + ': ';
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  autoResizeTextarea(input);
}


// ── Textarea auto-resize ──────────────────────────────────────────
function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}


// ── Simple markdown renderer ──────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return '';

  // Escape HTML first (except we'll add back intentional tags)
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const id = 'cb_' + Math.random().toString(36).slice(2, 8);
    return `<pre id="${id}"><button class="copy-code-btn" onclick="copyCode('${id}')">Copy</button><code class="lang-${lang || 'text'}">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>');

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Unordered lists
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>(\n|$))+/g, m => `<ul>${m}</ul>`);

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr>');

  // Line breaks → paragraphs
  const blocks = html.split(/\n{2,}/);
  html = blocks.map(block => {
    if (/^<(h[1-6]|ul|ol|li|pre|hr)/.test(block.trim())) return block;
    const lines = block.replace(/\n/g, '<br>').trim();
    return lines ? `<p>${lines}</p>` : '';
  }).join('\n');

  return html;
}

function copyCode(preId) {
  const pre = document.getElementById(preId);
  if (!pre) return;
  const code = pre.querySelector('code');
  const text = code ? code.textContent : '';
  navigator.clipboard.writeText(text).then(() => {
    const btn = pre.querySelector('.copy-code-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1500); }
  });
}


// ── Time formatting ───────────────────────────────────────────────
function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatRelative(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Baru saja';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' mnt lalu';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' jam lalu';
  return new Date(ts).toLocaleDateString('id-ID', { day:'numeric', month:'short' });
}


// ── Keyboard handler (global) ─────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeSettings();
    closeModelDropdown();
  }
});

document.addEventListener('click', e => {
  const dd = document.getElementById('modelDropdown');
  const btn = document.getElementById('modelSelectorBtn');
  if (dd && dd.classList.contains('open')) {
    if (!dd.contains(e.target) && !btn?.contains(e.target)) {
      closeModelDropdown();
    }
  }
});


// ── Page init (runs on every page) ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Restore saved model preference
  try {
    const saved = localStorage.getItem('mhr_model');
    if (saved) {
      window._mahiruCurrentModel = saved;
      const m = MahiruAPI && MahiruAPI.MODELS.find(x => x.id === saved);
      if (m) {
        const label = document.getElementById('modelLabel');
        const icon  = document.getElementById('modelIcon');
        if (label) label.textContent = m.label;
        if (icon)  { icon.textContent = m.icon; icon.style.color = m.color; }
      }
    } else {
      window._mahiruCurrentModel = 'mahiru-x-ultra';
    }
  } catch {}

  // Render suggestions if on chat page
  renderSuggestions();

  // Auto-resize textarea
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('input', () => {
      autoResizeTextarea(chatInput);
      const count = chatInput.value.length;
      const el = document.getElementById('charCount');
      if (el) {
        el.textContent = count > 200 ? `${count}` : '';
        el.classList.toggle('warn', count > 3000);
      }
    });

    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (window.MahiruChat) MahiruChat.sendMessage();
      }
    });
  }
});


// ── Export globals ────────────────────────────────────────────────
window.Toast              = Toast;
window.togglePwSettings   = togglePwSettings;
window.handleLogout       = handleLogout;
window.openSettings       = openSettings;
window.closeSettings      = closeSettings;
window.closeSettingsOnOverlay = closeSettingsOnOverlay;
window.saveSettings       = saveSettings;
window.toggleModelDropdown = toggleModelDropdown;
window.selectModel        = selectModel;
window.renderMarkdown     = renderMarkdown;
window.copyCode           = copyCode;
window.formatTime         = formatTime;
window.formatRelative     = formatRelative;
window.autoResizeTextarea = autoResizeTextarea;
window.useSuggestion      = useSuggestion;
