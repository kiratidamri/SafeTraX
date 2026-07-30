/* SafeTrax floating chat widget — bubble launcher + mini panel, backed by POST /api/chat */
(function () {
  var API_BASE = '';
  var history = [];
  var userId = null;
  try {
    var _u = JSON.parse(localStorage.getItem('safetrax_user'));
    userId = _u ? _u.id : localStorage.getItem('safetrax_user_id');
  } catch (e) { userId = localStorage.getItem('safetrax_user_id'); }

  var STYLE = `
    .stx-chat-root { position: fixed; left: 50%; bottom: 0; transform: translateX(-50%);
      width: 100%; max-width: var(--max-width, 480px); height: 0; pointer-events: none; z-index: 200; }
    .stx-chat-bubble { position: absolute; right: 1rem; bottom: 5.5rem; width: 52px; height: 52px;
      border-radius: 50%; background: var(--primary, #0071E3); color: #fff; border: none;
      box-shadow: var(--shadow-md, 0 4px 16px rgba(0,0,0,0.18)); font-size: 1.4rem; cursor: pointer;
      display: flex; align-items: center; justify-content: center; pointer-events: auto;
      transition: transform 0.15s ease; }
    .stx-chat-bubble:hover { transform: scale(1.06); }
    .stx-chat-bubble.stx-hidden { display: none; }
    .stx-chat-panel { position: absolute; right: 1rem; bottom: 5.5rem;
      width: min(340px, calc(100vw - 2rem)); height: min(60vh, 480px);
      background: var(--card-bg, #fff); border-radius: var(--radius, 14px);
      box-shadow: var(--shadow-md, 0 4px 16px rgba(0,0,0,0.18));
      border: 1px solid var(--border, rgba(0,0,0,0.09));
      display: none; flex-direction: column; overflow: hidden; pointer-events: auto; }
    .stx-chat-panel.stx-open { display: flex; }
    .stx-chat-head { display: flex; align-items: center; gap: 0.6rem; padding: 0.8rem 0.9rem;
      background: var(--primary, #0071E3); color: #fff; flex-shrink: 0; }
    .stx-chat-head .stx-avatar { font-size: 1.2rem; }
    .stx-chat-head .stx-title { flex: 1; font-size: 0.85rem; font-weight: 600; }
    .stx-chat-close { background: none; border: none; color: #fff; font-size: 1.1rem;
      cursor: pointer; opacity: 0.85; line-height: 1; padding: 0.2rem; }
    .stx-chat-close:hover { opacity: 1; }
    .stx-chat-msgs { flex: 1; overflow-y: auto; padding: 0.75rem; display: flex;
      flex-direction: column; gap: 0.5rem; background: var(--bg, #F5F5F7); }
    .stx-chat-msgs .stx-msg { max-width: 82%; padding: 0.5rem 0.7rem; border-radius: var(--radius-sm, 10px);
      font-size: 0.82rem; line-height: 1.35; white-space: pre-wrap; word-break: break-word; }
    .stx-chat-msgs .stx-msg.user { align-self: flex-end; background: var(--primary, #0071E3); color: #fff; }
    .stx-chat-msgs .stx-msg.bot { align-self: flex-start; background: var(--card-bg, #fff);
      color: var(--text, #1D1D1F); border: 1px solid var(--border, rgba(0,0,0,0.09)); }
    .stx-chat-msgs .stx-msg.error { align-self: flex-start; background: var(--danger-bg, #FFF1F1);
      color: var(--danger, #D70015); }
    .stx-typing-dots { display: flex; gap: 3px; padding: 0.2rem 0; }
    .stx-typing-dots span { width: 5px; height: 5px; border-radius: 50%; background: var(--text-muted, #6E6E73);
      animation: stx-blink 1.2s infinite ease-in-out; }
    .stx-typing-dots span:nth-child(2) { animation-delay: 0.15s; }
    .stx-typing-dots span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes stx-blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
    .stx-chat-inputrow { display: flex; gap: 0.5rem; padding: 0.6rem; border-top: 1px solid var(--border, rgba(0,0,0,0.09));
      background: var(--card-bg, #fff); flex-shrink: 0; }
    .stx-chat-inputrow input { flex: 1; border: 1px solid var(--border, rgba(0,0,0,0.09));
      border-radius: var(--radius-xs, 7px); padding: 0.5rem 0.6rem; font-size: 0.82rem;
      font-family: inherit; outline: none; }
    .stx-chat-inputrow input:focus { border-color: var(--primary, #0071E3); }
    .stx-chat-inputrow button { border: none; background: var(--primary, #0071E3); color: #fff;
      border-radius: var(--radius-xs, 7px); padding: 0 0.85rem; font-size: 0.8rem; font-weight: 600;
      cursor: pointer; }
    .stx-chat-inputrow button:disabled { opacity: 0.5; cursor: default; }
    @media (max-width: 360px) {
      .stx-chat-panel { right: 0.5rem; }
      .stx-chat-bubble { right: 0.5rem; }
    }
  `;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function init() {
    var styleTag = document.createElement('style');
    styleTag.textContent = STYLE;
    document.head.appendChild(styleTag);

    var root = el('div', 'stx-chat-root');

    var bubble = el('button', 'stx-chat-bubble', '&#129302;');
    bubble.setAttribute('aria-label', 'Open SafeTrax Assistant');

    var panel = el('div', 'stx-chat-panel');

    var head = el('div', 'stx-chat-head');
    head.appendChild(el('div', 'stx-avatar', '&#129302;'));
    head.appendChild(el('div', 'stx-title', 'SafeTrax Assistant'));
    var closeBtn = el('button', 'stx-chat-close', '&times;');
    closeBtn.setAttribute('aria-label', 'Close chat');
    head.appendChild(closeBtn);

    var msgs = el('div', 'stx-chat-msgs');
    msgs.setAttribute('role', 'log');
    msgs.setAttribute('aria-live', 'polite');

    var inputRow = el('div', 'stx-chat-inputrow');
    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Ask a question…';
    input.setAttribute('aria-label', 'Chat input');
    var sendBtn = el('button', null, 'Send');
    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);

    panel.appendChild(head);
    panel.appendChild(msgs);
    panel.appendChild(inputRow);

    root.appendChild(bubble);
    root.appendChild(panel);
    document.body.appendChild(root);

    var greeted = false;

    function scrollBottom() { msgs.scrollTop = msgs.scrollHeight; }

    function appendMsg(text, role) {
      var d = el('div', 'stx-msg ' + role);
      d.textContent = text;
      msgs.appendChild(d);
      scrollBottom();
      return d;
    }

    function showTyping() {
      var d = el('div', 'stx-msg bot', '<div class="stx-typing-dots"><span></span><span></span><span></span></div>');
      d.id = 'stx-typing';
      msgs.appendChild(d);
      scrollBottom();
    }

    function hideTyping() {
      var t = document.getElementById('stx-typing');
      if (t) t.remove();
    }

    function openPanel() {
      panel.classList.add('stx-open');
      bubble.classList.add('stx-hidden');
      if (!greeted) {
        appendMsg("Hi! I'm the SafeTrax Assistant. Ask me about risk scores, travel plans, or safety tips.", 'bot');
        greeted = true;
      }
      input.focus();
    }

    function closePanel() {
      panel.classList.remove('stx-open');
      bubble.classList.remove('stx-hidden');
    }

    function send() {
      var text = input.value.trim();
      if (!text) return;
      appendMsg(text, 'user');
      history.push({ role: 'user', content: text });
      input.value = '';
      sendBtn.disabled = true;
      showTyping();

      fetch(API_BASE + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, user_id: userId || undefined })
      })
        .then(function (r) {
          if (!r.ok) throw new Error('Server error ' + r.status);
          return r.json();
        })
        .then(function (data) {
          hideTyping();
          var reply = data.reply || 'Sorry, I could not generate a response.';
          appendMsg(reply, 'bot');
          history.push({ role: 'assistant', content: reply });
        })
        .catch(function (err) {
          hideTyping();
          appendMsg('Could not reach the server. (' + err.message + ')', 'error');
        })
        .finally(function () {
          sendBtn.disabled = false;
        });
    }

    bubble.addEventListener('click', openPanel);
    closeBtn.addEventListener('click', closePanel);
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); send(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
