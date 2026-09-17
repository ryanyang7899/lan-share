'use strict';

const crypto = require('node:crypto');
const { db } = require('./db');
const { SESSION_TTL, SESSION_COOKIE, LOGIN_MAX_FAILS, LOGIN_LOCK_MS, DEFAULT_ADMIN } = require('./config');

// ---------- 密码哈希（scrypt，Node 内置，无需额外依赖） ----------
// 存储格式：scrypt$<salt-hex>$<hash-hex>
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored || '').split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length);
    // 定长比较，避免时序侧信道
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------- 客户端 IP ----------
// Docker/Nginx 场景下可能是 IPv6 映射格式 ::ffff:192.168.31.53，统一归一化
function clientIp(req) {
  let ip = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

// ---------- Cookie（手写解析/序列化，避免引入额外依赖） ----------
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

function tokenFromReq(req) {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE] || null;
}

// HttpOnly 防脚本读取；SameSite=Lax 防跨站请求；局域网为 HTTP，故不加 Secure
function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL / 1000)}`;
}

function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ---------- 会话 ----------
function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    username,
    now,
    now + SESSION_TTL
  );
  return { token, expires_at: now + SESSION_TTL };
}

function getSession(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const user = db.prepare('SELECT id, username, role FROM users WHERE username = ?').get(row.username);
  if (!user) {
    // 账户已被删除，会话随之失效
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return user;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// 某账户被删除/改密后，让其所有会话失效
function destroyUserSessions(username) {
  db.prepare('DELETE FROM sessions WHERE username = ?').run(username);
}

// ---------- 登录失败锁定（按 IP） ----------
function checkLock(ip) {
  const row = db.prepare('SELECT * FROM login_attempts WHERE ip = ?').get(ip);
  if (!row || !row.locked_until) return { locked: false, remainingMs: 0, until: 0 };
  const now = Date.now();
  if (row.locked_until <= now) {
    // 冷却结束，自动恢复
    db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip);
    return { locked: false, remainingMs: 0, until: 0 };
  }
  return { locked: true, remainingMs: row.locked_until - now, until: row.locked_until };
}

// 记一次失败；累计到上限则锁定，返回当前状态
function recordFail(ip) {
  const now = Date.now();
  const row = db.prepare('SELECT * FROM login_attempts WHERE ip = ?').get(ip);
  const fails = (row ? row.fails : 0) + 1;

  if (fails >= LOGIN_MAX_FAILS) {
    const locked_until = now + LOGIN_LOCK_MS;
    db.prepare(
      `INSERT INTO login_attempts (ip, fails, first_fail_at, locked_until) VALUES (?, 0, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET fails = 0, locked_until = excluded.locked_until`
    ).run(ip, row ? row.first_fail_at : now, locked_until);
    return { locked: true, remainingMs: LOGIN_LOCK_MS, until: locked_until };
  }

  db.prepare(
    `INSERT INTO login_attempts (ip, fails, first_fail_at, locked_until) VALUES (?, ?, ?, NULL)
     ON CONFLICT(ip) DO UPDATE SET fails = excluded.fails`
  ).run(ip, fails, row ? row.first_fail_at || now : now);
  return { locked: false, remainingMs: 0, until: 0, fails };
}

function clearFails(ip) {
  db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip);
}

// 管理员手动解锁
function unlockIp(ip) {
  const info = db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip);
  return info.changes > 0;
}

function listLockedIps() {
  const now = Date.now();
  return db
    .prepare('SELECT ip, fails, locked_until FROM login_attempts WHERE locked_until IS NOT NULL AND locked_until > ? ORDER BY locked_until DESC')
    .all(now);
}

// 清理过期的会话与冷却结束的锁定记录
function cleanupAuth() {
  const now = Date.now();
  const s = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  const a = db
    .prepare('DELETE FROM login_attempts WHERE locked_until IS NOT NULL AND locked_until <= ?')
    .run(now);
  return { sessions: s.changes, attempts: a.changes };
}

// ---------- 首次启动创建默认管理员 ----------
function ensureDefaultAdmin() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return null;
  db.prepare('INSERT INTO users (username, password_hash, role, created_at, created_by) VALUES (?, ?, ?, ?, ?)').run(
    DEFAULT_ADMIN.username,
    hashPassword(DEFAULT_ADMIN.password),
    'admin',
    Date.now(),
    'system'
  );
  console.log(`[auth] 已创建默认管理员账户：${DEFAULT_ADMIN.username}`);
  return DEFAULT_ADMIN.username;
}

module.exports = {
  hashPassword,
  verifyPassword,
  clientIp,
  parseCookies,
  tokenFromReq,
  sessionCookie,
  clearCookie,
  createSession,
  getSession,
  destroySession,
  destroyUserSessions,
  checkLock,
  recordFail,
  clearFails,
  unlockIp,
  listLockedIps,
  cleanupAuth,
  ensureDefaultAdmin,
};
