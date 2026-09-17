'use strict';

const { db } = require('../db');
const {
  verifyPassword,
  hashPassword,
  clientIp,
  createSession,
  destroySession,
  tokenFromReq,
  sessionCookie,
  clearCookie,
  checkLock,
  recordFail,
  clearFails,
  destroyUserSessions,
} = require('../auth');
const { LOGIN_MAX_FAILS } = require('../config');

const PASS_MIN = 4;
const PASS_MAX = 128;

// 把毫秒差格式化成“X 小时 Y 分钟”，用于锁定提示
function fmtDuration(ms) {
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h} 小时${m > 0 ? ` ${m} 分钟` : ''}`;
  return `${m} 分钟`;
}

async function authRoutes(app) {
  // 登录
  app.post('/api/login', async (req, reply) => {
    const ip = clientIp(req);
    const body = req.body || {};
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    // 先查该 IP 是否处于锁定冷却中
    const lock = checkLock(ip);
    if (lock.locked) {
      return reply.code(403).send({
        error: `登录失败次数过多，该 IP 已锁定，请在 ${fmtDuration(lock.remainingMs)}后重试`,
        locked: true,
        remainingMs: lock.remainingMs,
      });
    }

    if (!username || !password) {
      return reply.code(400).send({ error: '请输入账户名和密码' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    // 用户不存在与密码错误返回同一提示，避免账户枚举
    const ok = user ? verifyPassword(password, user.password_hash) : false;

    if (!ok) {
      const state = recordFail(ip);
      if (state.locked) {
        return reply.code(403).send({
          error: `登录失败次数过多，该 IP 已锁定，请在 ${fmtDuration(state.remainingMs)}后重试`,
          locked: true,
          remainingMs: state.remainingMs,
        });
      }
      const left = LOGIN_MAX_FAILS - state.fails;
      return reply.code(401).send({
        error: `账户名或密码错误，还可尝试 ${left} 次`,
        remaining: left,
      });
    }

    clearFails(ip);
    const { token } = createSession(user.username);
    reply.header('Set-Cookie', sessionCookie(token));
    return { username: user.username, role: user.role };
  });

  // 登出
  app.post('/api/logout', async (req, reply) => {
    destroySession(tokenFromReq(req));
    reply.header('Set-Cookie', clearCookie());
    return { ok: true };
  });

  // 当前登录用户
  app.get('/api/me', async (req) => {
    return { username: req.user.username, role: req.user.role };
  });

  // 修改自己的密码（需验证原密码）
  app.post('/api/me/password', async (req, reply) => {
    const body = req.body || {};
    const oldPassword = String(body.oldPassword || '');
    const newPassword = String(body.newPassword || '');

    if (newPassword.length < PASS_MIN || newPassword.length > PASS_MAX) {
      return reply.code(400).send({ error: `新密码长度需在 ${PASS_MIN}-${PASS_MAX} 位之间` });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(req.user.username);
    if (!user || !verifyPassword(oldPassword, user.password_hash)) {
      return reply.code(401).send({ error: '原密码错误' });
    }

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
    // 改密后让其他设备的会话全部失效，仅保留当前会话
    const current = tokenFromReq(req);
    destroyUserSessions(user.username);
    const { token } = createSession(user.username);
    reply.header('Set-Cookie', sessionCookie(token));
    return { ok: true, reissued: Boolean(current) };
  });
}

module.exports = authRoutes;
