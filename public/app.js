'use strict';

// ---------- 工具 ----------
const $ = (sel) => document.querySelector(sel);
const fmtTime = (ts) => {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
};
const esc = (s) => {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
};

// 输入框回车发送：Enter（不带 Shift）= 提交表单，Shift+Enter = 换行。
// isComposing 跳过中文输入法组词状态，避免选字时误发送。
function bindEnterSubmit(el) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      const form = el.form;
      if (form) {
        if (form.requestSubmit) form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }
    }
  });
}

// Markdown 输入/预览切换：隐藏 textarea，实时渲染预览区
function bindMdToggle(textareaEl, previewEl) {
  const toggle = textareaEl.closest('.composer').querySelector('.md-toggle');
  const writeBtn = toggle.querySelector('[data-mode="write"]');
  const previewBtn = toggle.querySelector('[data-mode="preview"]');
  const showWrite = () => {
    writeBtn.classList.add('active');
    previewBtn.classList.remove('active');
    textareaEl.classList.remove('hidden');
    previewEl.classList.add('hidden');
  };
  const showPreview = () => {
    previewBtn.classList.add('active');
    writeBtn.classList.remove('active');
    previewEl.innerHTML = md(textareaEl.value) || '<p class="md-empty">（暂无内容）</p>';
    enhanceCodeBlocks(previewEl); // 预览里的代码块同样可复制
    textareaEl.classList.add('hidden');
    previewEl.classList.remove('hidden');
  };
  writeBtn.addEventListener('click', showWrite);
  previewBtn.addEventListener('click', showPreview);
  return { showWrite, showPreview };
}

// 已手动展开的条目集合（按 data-id 记忆），列表轮询重建后保持展开状态
const expandedSet = new Set();
// 长文本折叠：超过 limit 个字符时折叠为固定高度，追加「展开全文 / 收起」按钮。
// 展开状态记录在 expandedSet，避免公告板 10s 轮询重建后被重置
function applyCollapse(el, limit) {
  if (el.textContent.length <= limit) return;
  const idEl = el.closest('[data-id]');
  const key = idEl ? String(idEl.dataset.id) : null;
  const stayOpen = !!key && expandedSet.has(key);
  if (!stayOpen) el.classList.add('collapsed');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'collapse-btn';
  btn.textContent = stayOpen ? '收起' : '展开全文';
  btn.addEventListener('click', () => {
    const collapsed = el.classList.toggle('collapsed');
    btn.textContent = collapsed ? '展开全文' : '收起';
    if (key) {
      if (collapsed) expandedSet.delete(key);
      else expandedSet.add(key);
    }
  });
  if (el.nextSibling) el.parentNode.insertBefore(btn, el.nextSibling);
  else el.parentNode.appendChild(btn);
}

// 公告板时限下拉的选项 HTML：按公告当前时限高亮选中项
const POST_TTL_OPTIONS = [
  { v: 0, label: '永久' },
  { v: 86400, label: '1天' },
  { v: 259200, label: '3天' },
  { v: 604800, label: '7天' },
  { v: 2592000, label: '30天' },
];
function ttlOptionsHTML(p) {
  let current = null; // null = 永久
  if (p.expires_at) {
    current = Math.round((p.expires_at - p.created_at) / 1000); // 精确还原发布/修改时的 ttl
  }
  let html = '';
  // 非标准时限（如 1 秒测试）动态加一项展示
  if (p.expires_at && !POST_TTL_OPTIONS.some((o) => o.v === current)) {
    html += `<option value="${current}" selected>${fmtExpire(p.expires_at)}</option>`;
  }
  html += POST_TTL_OPTIONS.map(
    (o) =>
      `<option value="${o.v}" ${(current === null && o.v === 0) || current === o.v ? 'selected' : ''}>${o.label}</option>`
  ).join('');
  return html;
}

// 给 Markdown 代码块包一层并加独立复制按钮（代码块右上角）
function enhanceCodeBlocks(container) {
  container.querySelectorAll('pre').forEach((pre) => {
    if (pre.closest('.code-block')) return; // 已包装过
    const wrap = document.createElement('div');
    wrap.className = 'code-block';
    pre.parentNode.replaceChild(wrap, pre);
    wrap.appendChild(pre);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'code-copy';
    btn.textContent = '复制代码';
    btn.addEventListener('click', async () => {
      const ok = await copyText(pre.textContent.trim());
      btn.textContent = ok ? '已复制 ✓' : '复制失败';
      setTimeout(() => (btn.textContent = '复制代码'), 1500);
    });
    wrap.appendChild(btn);
  });
}

// 复制到剪贴板：优先 Clipboard API（仅 HTTPS/localhost），失败时降级到 execCommand。
// HTTP 局域网地址下 navigator.clipboard 不可用，必须回退。
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(String(text));
      return true;
    }
  } catch (e) {
    /* 降级到 execCommand */
  }
  const ta = document.createElement('textarea');
  ta.value = String(text);
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (e) {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
};
const fmtExpire = (expires_at) => {
  if (!expires_at) return '永不过期';
  const left = expires_at - Date.now();
  if (left <= 0) return '已过期';
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)} 天后过期`;
  if (h >= 1) return `${h} 小时后过期`;
  return `${Math.max(1, m)} 分钟后过期`;
};

// ---------- 当前登录用户（昵称与账户硬绑定，不可自行修改） ----------
let ME = { username: '', role: 'user' };
const getNick = () => ME.username;
const isAdmin = () => ME.role === 'admin';
// 管理员可操作任意内容，子账户仅限自己发布的
const canModify = (author) => isAdmin() || author === ME.username;

// 统一的请求封装：会话失效（401）时直接回登录页
async function api(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    location.href = '/login.html';
    throw new Error('未登录');
  }
  return res;
}

async function loadMe() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) {
      location.href = '/login.html';
      return false;
    }
    ME = await res.json();
  } catch {
    location.href = '/login.html';
    return false;
  }
  $('#me-name').textContent = ME.username;
  if (isAdmin()) {
    // 管理员专属区块（新增子账户 / 账户列表 / 锁定 IP）
    document.querySelectorAll('.admin-only').forEach((el) => el.classList.remove('hidden'));
  }
  return true;
}

$('#logout-btn').addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch {
    /* 忽略：无论成功与否都回登录页 */
  }
  location.href = '/login.html';
});

// ---------- Tab 切换 ----------
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`#${btn.dataset.tab}`).classList.add('active');
  });
});

// ---------- 公告板 ----------
const postList = $('#post-list');

async function loadPosts() {
  try {
    const res = await api('/api/posts');
    const posts = await res.json();
    postList.innerHTML =
      posts
        .map((p) => {
          const mine = canModify(p.author);
          return `
      <li class="item" data-id="${p.id}" data-expires="${p.expires_at || ''}">
        <div class="item-head">
          <span class="author">${esc(p.author)}</span>
          <div class="item-head-right">
            <span class="meta">${fmtTime(p.created_at)}</span>
            ${mine ? `<select class="post-ttl" data-post-ttl="${p.id}" title="设置过期时限">${ttlOptionsHTML(p)}</select>` : ''}
          </div>
        </div>
        <div class="item-body">${md(p.content)}</div>
        <div class="item-actions">
          <button class="link" data-copy-text data-src="${esc(p.content)}">复制</button>
          ${mine ? `<button class="link del" data-del-post="${p.id}">删除</button>` : ''}
        </div>
      </li>`;
        })
        .join('') || '<li class="empty">暂无内容</li>';
    postList.querySelectorAll('.item-body').forEach((el) => {
      applyCollapse(el, 400); // 超长公告折叠
      enhanceCodeBlocks(el); // 公告里的代码块加复制按钮
    });
    // 公告到期自动移除（轮询刷新兜底）
    postList.querySelectorAll('.item[data-expires]').forEach((el) => {
      const ex = Number(el.dataset.expires);
      if (ex > 0) scheduleExpiry(el, el.dataset.id, ex);
    });
    // 已发布公告设置/修改时限（右上角下拉，选择即生效）
    postList.querySelectorAll('[data-post-ttl]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const id = Number(sel.dataset.postTtl);
        const ttl = Number(sel.value) || null; // 0 = 永久
        await api(`/api/posts/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ttl }),
        });
        loadPosts();
      });
    });
    postList.querySelectorAll('[data-del-post]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api(`/api/posts/${btn.dataset.delPost}`, { method: 'DELETE' });
        loadPosts();
      });
    });
    postList.querySelectorAll('[data-copy-text]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        // 优先复制 Markdown 原文，便于在其他 MD 编辑器复用
        const ok = await copyText(btn.dataset.src);
        btn.textContent = ok ? '已复制 ✓' : '复制失败';
        setTimeout(() => (btn.textContent = '复制'), 1500);
      });
    });
  } catch (e) {
    // 首次加载失败时给出提示，轮询会自动重试
    if (!postList.querySelector('.item')) {
      postList.innerHTML = '<li class="error-state">加载失败，正在重试…</li>';
    }
  }
}

$('#post-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = $('#post-content').value.trim();
  if (!content) return;
  const ttl = Number($('#post-ttl').value) || null;
  // 作者由服务端按登录会话确定，前端不传昵称
  await api('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, ttl }),
  });
  $('#post-content').value = '';
  postMd.showWrite();
  loadPosts();
});
bindEnterSubmit($('#post-content')); // 公告板：Enter 发送，Shift+Enter 换行
const postMd = bindMdToggle($('#post-content'), $('#post-preview')); // 公告板：Markdown 预览

// 启动时统一加载（见文件末尾 init）

// ---------- 文件 ----------
const fileList = $('#file-list');
const dropzone = $('#dropzone');
const progress = $('#upload-progress');

async function loadFiles() {
  try {
    const res = await api('/api/files');
    const files = await res.json();
    fileList.innerHTML =
      files
        .map((f) => {
          const mine = canModify(f.uploader);
          return `
      <li class="item">
        <div class="item-head">
          <span class="author">📄 ${esc(f.name)}</span>
          <span class="meta">${fmtSize(f.size)}</span>
        </div>
        <div class="item-meta">${esc(f.uploader)} · ${fmtTime(f.created_at)}</div>
        <div class="item-meta">${fmtExpire(f.expires_at)}</div>
        <div class="item-actions">
          <a class="link" href="/files/${f.id}/download" download>下载</a>
          <button class="link" data-copy="${location.origin}/files/${f.id}/download">复制直链</button>
          ${mine ? `<button class="link del" data-del-file="${f.id}">删除</button>` : ''}
        </div>
      </li>`;
        })
        .join('') || '<li class="empty">暂无文件</li>';
    fileList.querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const ok = await copyText(btn.dataset.copy);
        btn.textContent = ok ? '已复制 ✓' : '复制失败';
        setTimeout(() => (btn.textContent = '复制直链'), 1500);
      });
    });
    fileList.querySelectorAll('[data-del-file]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api(`/api/files/${btn.dataset.delFile}`, { method: 'DELETE' });
        loadFiles();
      });
    });
  } catch (e) {
    // 首次加载失败时给出提示
    if (!fileList.querySelector('.item')) {
      fileList.innerHTML = '<li class="error-state">加载失败，正在重试…</li>';
    }
  }
}

async function uploadFiles(fileListArg) {
  const ttl = Number($('#file-ttl').value) || null;
  const total = fileListArg.length;
  let done = 0;
  const progressLabel = $('#upload-progress-label');
  const progressBar = $('#upload-progress-bar');
  progress.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressLabel.textContent = '上传中… 0/' + total;

  // 逐个上传，避免一次请求过大
  for (const file of fileListArg) {
    const fd = new FormData();
    fd.append('file', file);
    // 上传者由服务端按登录会话确定，前端不传昵称
    if (ttl) fd.append('ttl', String(ttl));
    try {
      await api('/api/files', { method: 'POST', body: fd });
    } catch (e) {
      /* 单个失败继续 */
    }
    done++;
    progressLabel.textContent = `上传中… ${done}/${total}`;
    progressBar.style.width = `${Math.round((done / total) * 100)}%`;
  }
  progressLabel.textContent = '上传完成';
  setTimeout(() => progress.classList.add('hidden'), 800);
  setTimeout(() => (progressBar.style.width = '0%'), 900);
  loadFiles();
}

dropzone.addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', (e) => {
  uploadFiles([...e.target.files]);
  e.target.value = '';
});
['dragover', 'dragenter'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add('over');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove('over');
  })
);
dropzone.addEventListener('drop', (e) => uploadFiles([...e.dataTransfer.files]));

// 启动时统一加载（见文件末尾 init）

// ---------- 聊天 ----------
const chatBox = $('#chat-box');
const chatInput = $('#chat-input');
const sendBtn = $('#chat-form button');
let ws = null;

// 聊天输入框随内容自适应高度（Shift+Enter 多行时能完整看到），最大 160px
const autoGrow = (el) => {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
};
chatInput.addEventListener('input', () => autoGrow(chatInput));
function msgHTML(m) {
  const mine = canModify(m.author); // 自己的消息（或管理员）可设置时限/撤回
  const ttlSel = mine
    ? `<select class="chat-ttl" data-chat-ttl="${m.id}" title="设置过期时限">${ttlOptionsHTML(m)}</select>`
    : '';
  const recallBtn = mine ? `<button class="link del recall" data-recall="${m.id}">撤回</button>` : '';
  return `<div class="chat-msg" data-id="${m.id}" data-created="${m.created_at}">
    <div class="chat-head">
      <span class="author">${esc(m.author)}</span>
      <span class="chat-time">${fmtTime(m.created_at)}</span>
      ${ttlSel}
      ${recallBtn}
    </div>
    <div class="chat-body">${md(m.content)}</div>
  </div>`;
}

// 到期自动移除的定时器（按消息 id）
const expiryTimers = new Map();
function scheduleExpiry(el, id, expiresAt) {
  const prev = expiryTimers.get(id);
  if (prev) clearTimeout(prev);
  if (!expiresAt) {
    expiryTimers.delete(id);
    return;
  }
  const delay = expiresAt - Date.now();
  if (delay <= 0) {
    el.remove();
    expiryTimers.delete(id);
    return;
  }
  const t = setTimeout(() => {
    el.remove();
    expiryTimers.delete(id);
  }, delay);
  expiryTimers.set(id, t);
}

function appendMsg(msg) {
  const block = document.createElement('div');
  block.innerHTML =
    msg.type === 'message'
      ? msgHTML(msg)
      : `<div class="chat-system">${esc(msg.author)} ${msg.type === 'join' ? '进入了聊天室' : '离开了聊天室'}（当前 ${msg.count} 人）</div>`;
  const node = block.firstChild;
  chatBox.appendChild(node);
  if (msg.type === 'message') {
    const body = node.querySelector('.chat-body');
    if (body) {
      applyCollapse(body, 400); // 超长消息折叠
      enhanceCodeBlocks(body); // 消息里的代码块加复制按钮
    }
    scheduleExpiry(node, msg.id, msg.expires_at); // 到点自动移除
  }
  chatBox.scrollTop = chatBox.scrollHeight;
}

function connectChat() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/api/chat`);

  ws.addEventListener('open', () => {
    chatInput.disabled = false;
    sendBtn.disabled = false;
  });
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'history') {
      chatBox.innerHTML = msg.messages.map(msgHTML).join('');
      msg.messages.forEach((m) => {
        const el = chatBox.querySelector(`[data-id="${m.id}"]`);
        const body = el && el.querySelector('.chat-body');
        if (body) {
          applyCollapse(body, 400);
          enhanceCodeBlocks(body);
        }
        if (el) scheduleExpiry(el, m.id, m.expires_at);
      });
      chatBox.scrollTop = chatBox.scrollHeight;
      return;
    }
    if (msg.type === 'recalled') {
      // 撤回/过期：彻底删除，直接移除该消息
      const el = chatBox.querySelector(`[data-id="${msg.id}"]`);
      if (el) el.remove();
      const timer = expiryTimers.get(msg.id);
      if (timer) {
        clearTimeout(timer);
        expiryTimers.delete(msg.id);
      }
      return;
    }
    if (msg.type === 'ttl') {
      // 某条已发送消息的时限被修改：更新下拉选中值并重置倒计时
      const el = chatBox.querySelector(`[data-id="${msg.id}"]`);
      if (!el) return;
      const sel = el.querySelector('[data-chat-ttl]');
      if (sel) {
        sel.innerHTML = ttlOptionsHTML({ created_at: Number(el.dataset.created), expires_at: msg.expires_at });
      }
      scheduleExpiry(el, msg.id, msg.expires_at);
      return;
    }
    appendMsg(msg);
  });
  ws.addEventListener('close', () => {
    chatInput.disabled = true;
    sendBtn.disabled = true;
    setTimeout(connectChat, 3000); // 断线重连
  });
}

// 事件委托：撤回（click）+ 已发送消息设置时限（change，选择即生效）
chatBox.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-recall]');
  if (btn && ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'recall', id: Number(btn.dataset.recall) }));
  }
});
chatBox.addEventListener('change', (e) => {
  const sel = e.target.closest('[data-chat-ttl]');
  if (sel && ws && ws.readyState === 1) {
    const ttl = Number(sel.value) || null; // 0 = 永久
    ws.send(JSON.stringify({ type: 'ttl', id: Number(sel.dataset.chatTtl), ttl }));
  }
});

$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const content = chatInput.value.trim();
  if (!content) return;
  // 消息由服务端广播回所有客户端（含自己），无需本地预渲染
  if (ws && ws.readyState === 1) {
    const ttl = Number($('#chat-ttl').value) > 0 ? Number($('#chat-ttl').value) : null;
    // 作者由服务端按登录会话确定，前端不传昵称
    ws.send(JSON.stringify({ type: 'message', content, ttl }));
    chatInput.value = '';
    chatMd.showWrite();
    autoGrow(chatInput);
  }
});
bindEnterSubmit(chatInput); // 聊天：Enter 发送，Shift+Enter 换行
const chatMd = bindMdToggle(chatInput, $('#chat-preview')); // 聊天：Markdown 预览

// ---------- 账户 ----------
function showFormMsg(el, text, ok) {
  el.textContent = text;
  el.className = `form-msg ${ok ? 'ok' : 'error'}`;
}

// 修改自己的密码
$('#self-pass-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = $('#self-msg');
  const oldPassword = $('#old-pass').value;
  const newPassword = $('#new-pass').value;
  try {
    const res = await api('/api/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showFormMsg(msgEl, data.error || '修改失败', false);
    showFormMsg(msgEl, '密码已修改', true);
    $('#old-pass').value = '';
    $('#new-pass').value = '';
  } catch {
    /* 401 已由 api() 跳转处理 */
  }
});

// 管理员：账户列表
async function loadUsers() {
  if (!isAdmin()) return;
  const list = $('#user-list');
  try {
    const res = await api('/api/users');
    const users = await res.json();
    list.innerHTML =
      users
        .map((u) => {
          const isMe = u.username === ME.username;
          return `
      <li class="item" data-uid="${u.id}">
        <div class="item-head">
          <span class="author">${esc(u.username)}${u.role === 'admin' ? ' <span class="tag">管理员</span>' : ''}${isMe ? ' <span class="tag">当前</span>' : ''}</span>
          <span class="meta">${fmtTime(u.created_at)}</span>
        </div>
        <div class="item-actions">
          <button class="link" data-reset-user="${u.id}" data-name="${esc(u.username)}">重置密码</button>
          ${isMe ? '' : `<button class="link del" data-del-user="${u.id}" data-name="${esc(u.username)}">删除</button>`}
        </div>
      </li>`;
        })
        .join('') || '<li class="empty">暂无子账户</li>';

    list.querySelectorAll('[data-del-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`确定删除账户「${btn.dataset.name}」？该账户将立即无法登录。`)) return;
        await api(`/api/users/${btn.dataset.delUser}`, { method: 'DELETE' });
        loadUsers();
      });
    });
    list.querySelectorAll('[data-reset-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pwd = prompt(`为「${btn.dataset.name}」设置新密码（4-128 位）：`);
        if (!pwd) return;
        const res = await api(`/api/users/${btn.dataset.resetUser}/password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPassword: pwd }),
        });
        const data = await res.json().catch(() => ({}));
        showFormMsg($('#user-msg'), res.ok ? `已重置「${btn.dataset.name}」的密码` : data.error || '重置失败', res.ok);
      });
    });
  } catch {
    list.innerHTML = '<li class="error-state">加载失败</li>';
  }
}

// 管理员：新增子账户
$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msgEl = $('#user-msg');
  const username = $('#new-username').value.trim();
  const password = $('#new-password').value;
  if (!username) return showFormMsg(msgEl, '账户名不能为空', false);

  try {
    const res = await api('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return showFormMsg(msgEl, data.error || '添加失败', false);
    showFormMsg(msgEl, `已添加账户「${data.username}」`, true);
    $('#new-username').value = '';
    $('#new-password').value = '';
    loadUsers();
  } catch {
    /* 401 已处理 */
  }
});

// 管理员：被锁定的 IP
async function loadLockedIps() {
  if (!isAdmin()) return;
  const list = $('#locked-list');
  try {
    const res = await api('/api/locked-ips');
    const rows = await res.json();
    list.innerHTML =
      rows
        .map(
          (r) => `
      <li class="item" data-ip="${esc(r.ip)}">
        <div class="item-head">
          <span class="author">${esc(r.ip)}</span>
          <span class="meta">${fmtExpire(r.locked_until)}</span>
        </div>
        <div class="item-actions">
          <button class="link" data-unlock="${esc(r.ip)}">解除锁定</button>
        </div>
      </li>`
        )
        .join('') || '<li class="empty">当前没有被锁定的 IP</li>';

    list.querySelectorAll('[data-unlock]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api(`/api/locked-ips/${encodeURIComponent(btn.dataset.unlock)}`, { method: 'DELETE' });
        loadLockedIps();
      });
    });
  } catch {
    list.innerHTML = '<li class="error-state">加载失败</li>';
  }
}

// ---------- 启动 ----------
(async function init() {
  // 未登录时 loadMe 会把页面重定向到登录页，后续请求不再发起
  if (!(await loadMe())) return;

  postList.innerHTML = '<li class="loading">加载中…</li>';
  loadPosts();
  setInterval(loadPosts, 10000); // 轮询刷新

  fileList.innerHTML = '<li class="loading">加载中…</li>';
  loadFiles();

  loadUsers();
  loadLockedIps();
  connectChat();
})();
