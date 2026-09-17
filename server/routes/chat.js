'use strict';

const { db } = require('../db');
const { CONTENT_MAX } = require('../config');

const clients = new Set();

function broadcast(obj) {
  const raw = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(raw);
  }
}

// ttl 为秒数；非法或 <=0 视为永久
function parseTTL(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// 删除已过期的消息并广播移除（供清理任务调用）
function removeExpiredMessages() {
  const now = Date.now();
  const rows = db
    .prepare('SELECT id FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?')
    .all(now);
  if (!rows.length) return 0;
  const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
  const del = db.transaction((list) => {
    for (const r of list) {
      stmt.run(r.id);
      broadcast({ type: 'recalled', id: r.id });
    }
  });
  del(rows);
  return rows.length;
}

function chatRoute(app) {
  // 第二个参数 req 由 @fastify/websocket 传入，鉴权钩子已把登录用户挂在 req.user 上
  app.get('/api/chat', { websocket: true }, (socket, req) => {
    const me = req.user;
    if (!me) {
      socket.close();
      return;
    }
    // 管理员可操作任意消息，子账户仅限自己的
    const canModify = (id) => {
      const row = db.prepare('SELECT author FROM messages WHERE id = ?').get(id);
      if (!row) return false;
      return me.role === 'admin' || row.author === me.username;
    };

    // 进房：先补最近 50 条未过期历史
    const history = db
      .prepare('SELECT * FROM messages WHERE expires_at IS NULL OR expires_at > ? ORDER BY created_at DESC LIMIT 50')
      .all(Date.now())
      .reverse();
    socket.send(JSON.stringify({ type: 'history', messages: history }));

    clients.add(socket);
    broadcast({ type: 'join', count: clients.size });

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      // 撤回：从数据库彻底删除该消息并广播，所有客户端移除展示
      if (msg.type === 'recall') {
        const id = Number(msg.id);
        if (Number.isInteger(id) && id > 0 && canModify(id)) {
          const info = db.prepare('DELETE FROM messages WHERE id = ?').run(id);
          if (info.changes > 0) broadcast({ type: 'recalled', id });
        }
        return;
      }

      // 设置/修改已发送消息的过期时限（ttl 为 0 或空 = 取消时限/永久）
      if (msg.type === 'ttl') {
        const id = Number(msg.id);
        if (!(Number.isInteger(id) && id > 0)) return;
        if (!canModify(id)) return;
        const ttl = parseTTL(msg.ttl);
        const expires_at = ttl ? Date.now() + ttl * 1000 : null;
        const info = db.prepare('UPDATE messages SET expires_at = ? WHERE id = ?').run(expires_at, id);
        if (info.changes > 0) broadcast({ type: 'ttl', id, expires_at });
        return;
      }

      if (msg.type !== 'message') return;

      const content = String(msg.content || '').trim().slice(0, CONTENT_MAX);
      if (!content) return;

      const author = me.username; // 昵称与账户绑定，忽略客户端自报的 author
      const created_at = Date.now();
      const ttl = parseTTL(msg.ttl);
      const expires_at = ttl ? created_at + ttl * 1000 : null;

      const info = db
        .prepare('INSERT INTO messages (author, content, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(author, content, created_at, expires_at);

      broadcast({ type: 'message', id: info.lastInsertRowid, author, content, created_at, expires_at });
    });

    socket.on('close', () => {
      clients.delete(socket);
      broadcast({ type: 'leave', count: clients.size });
    });
  });
}

module.exports = chatRoute;
module.exports.broadcast = broadcast;
module.exports.removeExpiredMessages = removeExpiredMessages;
