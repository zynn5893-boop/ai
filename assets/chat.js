/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  chat.js — Mahiru AI Chat Engine                            ║
 * ║  Handles: conversations, streaming, history, UI             ║
 * ║  LangitDev © 2025                                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

const MahiruChat = (() => {

  // ── State ────────────────────────────────────────────────────────
  let _session       = null;
  let _conversations = {};  // { id: { id, title, messages[], createdAt, model } }
  let _currentId     = null;
  let _isStreaming   = false;
  let _abortCtrl     = null;

  const STORAGE_KEY  = 'mhr_chats_v2';
  const MAX_HISTORY  = 40;   // messages kept per conversation
  const MAX_CONTEXT  = 12;   // messages sent to API

  // ── Init ─────────────────────────────────────────────────────────
  function init() {
    _session = MahiruAuth.requireAuth();
    if (!_session) return;

    // Load conversations
    _loadConversations();

    // Render sidebar user info
    _renderUserInfo();

    // Render chat list
    _renderChatList();

    // Restore or create conversation
    const lastId = localStorage.getItem(`mhr_last_chat_${_session.username}`);
    if (lastId && _conversations[lastId]) {
      _loadConversation(lastId);
    } else {
      _showEmptyState();
    }

    // Show admin button if admin
    const adminBtn = document.getElementById('adminBtn');
    if (adminBtn && _session.role === 'admin') {
      adminBtn.classList.remove('hidden');
    }

    // Load saved model
    const savedModel = localStorage.getItem('mhr_model') || 'mahiru-x-ultra';
    window._mahiruCurrentModel = savedModel;
    _updateModelDisplay(savedModel);
  }

  // ── Storage ──────────────────────────────────────────────────────
  function _loadConversations() {
    try {
      const raw = localStorage.getItem(`${STORAGE_KEY}_${_session.username}`);
      _conversations = raw ? JSON.parse(raw) : {};
    } catch {
      _conversations = {};
    }
  }

  function _saveConversations() {
    try {
      localStorage.setItem(
        `${STORAGE_KEY}_${_session.username}`,
        JSON.stringify(_conversations)
      );
    } catch (e) {
      console.warn('Failed to save chats:', e);
    }
  }

  // ── Conversation management ──────────────────────────────────────
  function newChat() {
    _currentId = null;
    _showEmptyState();
    _renderChatList();
    const input = document.getElementById('chatInput');
    if (input) { input.value = ''; input.focus(); autoResizeTextarea(input); }
  }

  function _createConversation(firstMessage, model) {
    const id = 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const title = _generateTitle(firstMessage);
    _conversations[id] = {
      id,
      title,
      model,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    _saveConversations();
    return id;
  }

  function _generateTitle(text) {
    const clean = text.replace(/\n/g, ' ').trim();
    return clean.length > 45 ? clean.slice(0, 45) + '…' : clean;
  }

  function _loadConversation(id) {
    const conv = _conversations[id];
    if (!conv) return;

    _currentId = id;
    localStorage.setItem(`mhr_last_chat_${_session.username}`, id);

    // Restore model
    if (conv.model) {
      window._mahiruCurrentModel = conv.model;
      _updateModelDisplay(conv.model);
    }

    // Render messages
    const container = document.getElementById('messages');
    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.style.display = 'none';

    // Clear old messages (keep empty state in DOM)
    const oldMsgs = container.querySelectorAll('.message');
    oldMsgs.forEach(m => m.remove());

    // Render each message
    conv.messages.forEach(msg => {
      _appendMessageToDOM(msg.role, msg.content, msg.model, msg.ts, false);
    });

    _scrollToBottom();
    _renderChatList();
  }

  function deleteConversation(id) {
    if (!confirm('Hapus percakapan ini?')) return;
    delete _conversations[id];
    _saveConversations();
    if (_currentId === id) {
      _currentId = null;
      _showEmptyState();
    }
    _renderChatList();
  }

  // ── Send message ─────────────────────────────────────────────────
  async function sendMessage() {
    if (_isStreaming) return;

    const input   = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const stopBtn = document.getElementById('stopBtn');

    const text = input.value.trim();
    if (!text) return;

    // Rate limit check
    const rate = MahiruAuth.checkRateLimit(_session.username);
    if (!rate.ok) {
      Toast.error(rate.msg);
      return;
    }

    const model = window._mahiruCurrentModel || 'mahiru-x-ultra';

    // Create conversation if needed
    if (!_currentId) {
      _currentId = _createConversation(text, model);
      const emptyState = document.getElementById('emptyState');
      if (emptyState) emptyState.style.display = 'none';
      localStorage.setItem(`mhr_last_chat_${_session.username}`, _currentId);
    }

    // Add user message
    const userMsg = { role: 'user', content: text, ts: Date.now() };
    _conversations[_currentId].messages.push(userMsg);
    _conversations[_currentId].updatedAt = Date.now();
    _appendMessageToDOM('user', text, null, userMsg.ts);
    _saveConversations();

    // Clear input
    input.value = '';
    autoResizeTextarea(input);
    const charCount = document.getElementById('charCount');
    if (charCount) charCount.textContent = '';

    // UI state: streaming
    _isStreaming = true;
    sendBtn.classList.add('hidden');
    stopBtn.classList.add('show');
    input.disabled = true;

    // Build context (last N messages)
    const allMsgs = _conversations[_currentId].messages;
    const context = allMsgs.slice(-MAX_CONTEXT).map(m => ({
      role: m.role,
      content: m.content,
    }));

    // Create AI message placeholder
    const aiMsgId = 'ai_' + Date.now();
    _appendStreamingPlaceholder(aiMsgId, model);
    _scrollToBottom();

    let fullResponse = '';

    try {
      _abortCtrl = new AbortController();

      fullResponse = await MahiruAPI.send(model, context, (chunk) => {
        fullResponse += '';  // tracked inside send()
        _appendChunkToDOM(aiMsgId, chunk);
        _scrollToBottom();
      });

      // Finalize message in DOM (remove streaming cursor, render markdown)
      _finalizeStreamingMessage(aiMsgId, fullResponse);

      // Save AI message to conversation
      const aiMsg = {
        role: 'assistant',
        content: fullResponse,
        model,
        ts: Date.now(),
      };
      _conversations[_currentId].messages.push(aiMsg);

      // Trim history
      if (_conversations[_currentId].messages.length > MAX_HISTORY) {
        _conversations[_currentId].messages = _conversations[_currentId].messages.slice(-MAX_HISTORY);
      }

      _conversations[_currentId].updatedAt = Date.now();
      _saveConversations();
      _renderChatList();

    } catch (err) {
      if (err.name === 'AbortError') {
        // User stopped — save partial
        if (fullResponse.trim()) {
          _finalizeStreamingMessage(aiMsgId, fullResponse + '\n\n_[Dihentikan]_');
          _conversations[_currentId].messages.push({
            role: 'assistant',
            content: fullResponse,
            model,
            ts: Date.now(),
          });
          _saveConversations();
        } else {
          // Remove placeholder
          const el = document.getElementById(aiMsgId);
          if (el) el.remove();
        }
      } else {
        _finalizeStreamingMessage(aiMsgId, null, err.message);
        Toast.error(err.message, 5000);
      }
    } finally {
      _isStreaming = false;
      _abortCtrl = null;
      sendBtn.classList.remove('hidden');
      stopBtn.classList.remove('show');
      input.disabled = false;
      input.focus();
    }
  }

  function stopStream() {
    if (_abortCtrl) {
      _abortCtrl.abort();
    }
  }

  // ── DOM rendering ─────────────────────────────────────────────────
  function _appendMessageToDOM(role, content, model, ts, animate = true) {
    const container = document.getElementById('messages');
    const modelInfo = model ? MahiruAPI.MODELS.find(m => m.id === model) : null;

    const avatarContent = role === 'user'
      ? (_session?.name?.charAt(0).toUpperCase() || 'U')
      : '✦';

    const authorName = role === 'user' ? (_session?.name || 'Kamu') : 'Mahiru';

    const badgeHtml = modelInfo ? `
      <span class="msg-model-badge" style="background:${modelInfo.color}20;color:${modelInfo.color}">
        ${modelInfo.badge}
      </span>` : '';

    const timeStr = formatTime(ts || Date.now());

    const div = document.createElement('div');
    div.className = 'msg-wrap';
    if (animate) div.style.animation = 'fadeUp 0.2s ease both';

    div.innerHTML = `
      <div class="message">
        <div class="msg-avatar ${role}">${avatarContent}</div>
        <div class="msg-body">
          <div class="msg-meta">
            <span class="msg-author">${role === 'user' ? authorName : 'Mahiru'}</span>
            ${badgeHtml}
            <span class="msg-time">${timeStr}</span>
          </div>
          <div class="msg-content">${renderMarkdown(content)}</div>
          <div class="msg-actions">
            <button class="msg-action-btn" onclick="MahiruChat._copyMessage(this)">
              📋 Salin
            </button>
            ${role === 'assistant' ? `<button class="msg-action-btn" onclick="MahiruChat._regenerate(this)">↺ Ulangi</button>` : ''}
          </div>
        </div>
      </div>`;

    // Store raw content for copy
    div.querySelector('.msg-content').dataset.raw = content;

    container.appendChild(div);
    return div;
  }

  function _appendStreamingPlaceholder(id, model) {
    const container = document.getElementById('messages');
    const modelInfo = MahiruAPI.MODELS.find(m => m.id === model);
    const badgeHtml = modelInfo ? `
      <span class="msg-model-badge" style="background:${modelInfo.color}20;color:${modelInfo.color}">
        ${modelInfo.badge}
      </span>` : '';

    const div = document.createElement('div');
    div.className = 'msg-wrap';
    div.id = id;
    div.innerHTML = `
      <div class="message">
        <div class="msg-avatar ai">✦</div>
        <div class="msg-body">
          <div class="msg-meta">
            <span class="msg-author">Mahiru</span>
            ${badgeHtml}
            <span class="msg-time">${formatTime(Date.now())}</span>
          </div>
          <div class="msg-content streaming-cursor" id="${id}_content">
            <div class="typing-indicator">
              <div class="typing-dot"></div>
              <div class="typing-dot"></div>
              <div class="typing-dot"></div>
            </div>
          </div>
        </div>
      </div>`;
    container.appendChild(div);
  }

  let _streamBuffer = {};

  function _appendChunkToDOM(id, chunk) {
    const contentEl = document.getElementById(`${id}_content`);
    if (!contentEl) return;

    // Remove typing indicator on first chunk
    const typingIndicator = contentEl.querySelector('.typing-indicator');
    if (typingIndicator) typingIndicator.remove();

    // Accumulate raw text
    if (!_streamBuffer[id]) _streamBuffer[id] = '';
    _streamBuffer[id] += chunk;

    // Render partial markdown
    contentEl.innerHTML = renderMarkdown(_streamBuffer[id]);
    contentEl.classList.add('streaming-cursor');
  }

  function _finalizeStreamingMessage(id, fullText, errorMsg) {
    const wrapper = document.getElementById(id);
    if (!wrapper) return;

    const contentEl = document.getElementById(`${id}_content`);
    if (!contentEl) return;

    contentEl.classList.remove('streaming-cursor');
    delete _streamBuffer[id];

    if (errorMsg) {
      contentEl.innerHTML = `<span style="color:var(--red)">⚠ ${MahiruAuth.sanitize(errorMsg)}</span>`;
      return;
    }

    contentEl.innerHTML = renderMarkdown(fullText || '');
    contentEl.dataset.raw = fullText || '';

    // Add action buttons if not present
    const msgBody = wrapper.querySelector('.msg-body');
    if (msgBody && !msgBody.querySelector('.msg-actions')) {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.innerHTML = `
        <button class="msg-action-btn" onclick="MahiruChat._copyMessage(this)">📋 Salin</button>
        <button class="msg-action-btn" onclick="MahiruChat._regenerate(this)">↺ Ulangi</button>`;
      msgBody.appendChild(actions);
    }
  }

  // ── Sidebar ───────────────────────────────────────────────────────
  function _renderUserInfo() {
    const avatar   = document.getElementById('userAvatar');
    const nameEl   = document.getElementById('userName');
    const roleEl   = document.getElementById('userRole');
    const emptyName = document.getElementById('emptyName');

    if (avatar)    avatar.textContent = _session.name.charAt(0).toUpperCase();
    if (nameEl)    nameEl.textContent = _session.name;
    if (roleEl)    roleEl.textContent = _session.role === 'admin' ? '🛡 Admin' : 'User';
    if (emptyName) emptyName.textContent = _session.name.split(' ')[0];
  }

  function _renderChatList() {
    const list = document.getElementById('chatList');
    if (!list) return;

    // Sort by updatedAt desc
    const convs = Object.values(_conversations)
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));

    if (convs.length === 0) {
      list.innerHTML = '<div style="padding:20px 10px;text-align:center;font-size:0.75rem;color:var(--muted)">Belum ada percakapan</div>';
      return;
    }

    list.innerHTML = convs.map(c => `
      <div class="chat-item ${c.id === _currentId ? 'active' : ''}" onclick="MahiruChat._loadConversation('${c.id}')">
        <span class="chat-item-icon">💬</span>
        <span class="chat-item-title" title="${MahiruAuth.sanitize(c.title)}">${MahiruAuth.sanitize(c.title)}</span>
        <button class="chat-item-del" onclick="event.stopPropagation();MahiruChat.deleteConversation('${c.id}')" title="Hapus">✕</button>
      </div>`).join('');
  }

  function _showEmptyState() {
    const messages = document.getElementById('messages');
    const emptyState = document.getElementById('emptyState');

    // Remove all message elements
    const msgs = messages.querySelectorAll('.msg-wrap');
    msgs.forEach(m => m.remove());

    if (emptyState) emptyState.style.display = '';

    // Update active state in chat list
    _renderChatList();
  }

  // ── Utilities ────────────────────────────────────────────────────
  function clearMessages() {
    if (!_currentId) return;
    if (!confirm('Hapus semua pesan di percakapan ini?')) return;
    _conversations[_currentId].messages = [];
    _saveConversations();
    const msgs = document.getElementById('messages').querySelectorAll('.msg-wrap');
    msgs.forEach(m => m.remove());
    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.style.display = '';
    Toast.info('Pesan dihapus');
  }

  function _scrollToBottom() {
    const container = document.getElementById('messages');
    if (container) container.scrollTop = container.scrollHeight;
  }

  function _updateModelDisplay(modelId) {
    const m = MahiruAPI.MODELS.find(x => x.id === modelId);
    if (!m) return;
    const label = document.getElementById('modelLabel');
    const icon  = document.getElementById('modelIcon');
    if (label) label.textContent = m.label;
    if (icon)  { icon.textContent = m.icon; icon.style.color = m.color; }
  }

  function _copyMessage(btn) {
    const contentEl = btn.closest('.msg-body')?.querySelector('.msg-content');
    if (!contentEl) return;
    const text = contentEl.dataset.raw || contentEl.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const old = btn.textContent;
      btn.textContent = '✓ Disalin';
      setTimeout(() => btn.textContent = old, 1500);
    });
  }

  async function _regenerate(btn) {
    if (_isStreaming) return;
    if (!_currentId) return;

    const conv = _conversations[_currentId];
    if (!conv || conv.messages.length < 2) return;

    // Remove last AI message from storage
    const lastMsg = conv.messages[conv.messages.length - 1];
    if (lastMsg.role !== 'assistant') return;
    conv.messages.pop();
    _saveConversations();

    // Remove last AI message from DOM
    const allWrappers = document.querySelectorAll('#messages .msg-wrap');
    if (allWrappers.length > 0) {
      allWrappers[allWrappers.length - 1].remove();
    }

    // Rebuild context & re-send
    const model = window._mahiruCurrentModel || conv.model || 'mahiru-x-ultra';
    const context = conv.messages.slice(-MAX_CONTEXT).map(m => ({
      role: m.role,
      content: m.content,
    }));

    const rate = MahiruAuth.checkRateLimit(_session.username);
    if (!rate.ok) { Toast.error(rate.msg); return; }

    const sendBtn = document.getElementById('sendBtn');
    const stopBtn = document.getElementById('stopBtn');
    const input   = document.getElementById('chatInput');

    _isStreaming = true;
    sendBtn.classList.add('hidden');
    stopBtn.classList.add('show');
    if (input) input.disabled = true;

    const aiMsgId = 'ai_' + Date.now();
    _appendStreamingPlaceholder(aiMsgId, model);
    _scrollToBottom();

    let fullResponse = '';

    try {
      _abortCtrl = new AbortController();
      fullResponse = await MahiruAPI.send(model, context, (chunk) => {
        _appendChunkToDOM(aiMsgId, chunk);
        _scrollToBottom();
      });

      _finalizeStreamingMessage(aiMsgId, fullResponse);

      conv.messages.push({ role: 'assistant', content: fullResponse, model, ts: Date.now() });
      conv.updatedAt = Date.now();
      _saveConversations();

    } catch (err) {
      if (err.name !== 'AbortError') {
        _finalizeStreamingMessage(aiMsgId, null, err.message);
        Toast.error(err.message, 5000);
      } else {
        const el = document.getElementById(aiMsgId);
        if (el) el.remove();
      }
    } finally {
      _isStreaming = false;
      _abortCtrl = null;
      sendBtn.classList.remove('hidden');
      stopBtn.classList.remove('show');
      if (input) { input.disabled = false; input.focus(); }
    }
  }

  // ── Public API ────────────────────────────────────────────────────
  return {
    init,
    newChat,
    sendMessage,
    stopStream,
    clearMessages,
    deleteConversation,
    _loadConversation,
    _copyMessage,
    _regenerate,
  };

})();

// ── Boot ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  MahiruChat.init();
});
