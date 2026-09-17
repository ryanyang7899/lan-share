'use strict';

const { db } = require('../db');
const { hashPassword, destroyUserSessions, unlockIp, listLockedIps } = require('../auth');
const { NICK_MAX } = require('../config');

const PASS_MIN = 4;
const PASS_MAX = 128;

// 仅管理员可访问
function requireAdmin(req, reply, done) {
  if (!req.user || req.user.role !== 'admin') {
    reply.code(403).send({ error: '仅管理员可执行此操作' });
    return;
  }
  done();
}

function parseUsername(raw) {
  // 账户名同时作为系统昵称，限制长度并去掉首尾空白
  return String(raw || '').trim().slice(0, NICK_MAX);
}

async function usersRoutes(app) {
  app.addHook('preHandler', requireAdmin);

  // 账户列表（不返回密码哈希）
  app.get('/api/users', async () => {
    return db
      .prepare('SELECT id, username, role, created_at, created_by FROM users ORDER BY created_at ASC')
      .all();
  });

  // 新增子账户：账户名必填，作为系统内昵称
  app.post('/api/users', async (req, reply) => {
    const body = req.body || {};
    const username = parseUsername(body.username);
    const password = String(body.password || '');

    if (!username) return reply.code(400).send({ error: '账户名不能为空' });
    if (password.length < PASS_MIN || password.length > PASS_MAX) {
      return reply.code(400).send({ error: `密码长度需在 ${PASS_MIN}-${PASS_MAX} 位之间` });
    }
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      return reply.code(409).send({ error: '该账户名已存在' });
    }

    const info = db
      .prepare('INSERT INTO users (username, password_hash, role, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(username, hashPassword(password), 'user', Date.now(), req.user.username);

    return { id: info.lastInsertRowid, username, role: 'user' };
  });

  // 删除账户
  app.delete('/api/users/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!row) return reply.code(404).send({ error: '账户不存在' });
    if (row.username === req.user.username) {
      return reply.code(400).send({ error: '不能删除当前登录的账户' });
    }
    if (row.role === 'admin') {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
      if (admins <= 1) return reply.code(400).send({ error: '至少需保留一个管理员账户' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
    destroyUserSessions(row.username); // 该账户的会话立即失效
    return { ok: true };
  });

  // 管理员重置子账户密码
  app.post('/api/users/:id/password', async (req, reply) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!row) return reply.code(404).send({ error: '账户不存在' });

    const newPassword = String((req.body || {}).newPassword || '');
    if (newPassword.length < PASS_MIN || newPassword.length > PASS_MAX) {
      return reply.code(400).send({ error: `密码长度需在 ${PASS_MIN}-${PASS_MAX} 位之间` });
    }

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), row.id);
    destroyUserSessions(row.username);
    return { ok: true };
  });

  // 被锁定的 IP 列表
  app.get('/api/locked-ips', async () => listLockedIps());

  // 手动解锁某个 IP
  app.delete('/api/locked-ips/:ip', async (req, reply) => {
    const ok = unlockIp(decodeURIComponent(req.params.ip));
    if (!ok) return reply.code(404).send({ error: '该 IP 未被锁定' });
    return { ok: true };
  });
}

module.exports = usersRoutes;
