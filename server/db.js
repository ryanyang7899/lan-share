'use strict';

const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'share.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL DEFAULT '匿名',
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL DEFAULT '匿名',
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    mime TEXT,
    uploader TEXT NOT NULL DEFAULT '匿名',
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    path TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_posts_created  ON posts(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_expires  ON posts(expires_at);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_files_created  ON files(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_files_expires  ON files(expires_at);

  -- 账户表：username 即系统内昵称（发言/上传时的显示名），role 区分管理员与子账户
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL,
    created_by TEXT
  );

  -- 会话表：登录成功后签发随机 token，存库以便容器重启后不掉线
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- 登录失败记录：按 IP 累计，满 5 次锁定 24 小时
  CREATE TABLE IF NOT EXISTS login_attempts (
    ip TEXT PRIMARY KEY,
    fails INTEGER NOT NULL DEFAULT 0,
    first_fail_at INTEGER,
    locked_until INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`);

// 迁移：老库 messages 表可能没有 expires_at 列（必须先加列，再建该列上的索引）
const msgCols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
if (!msgCols.includes('expires_at')) {
  db.exec('ALTER TABLE messages ADD COLUMN expires_at INTEGER');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at)');

module.exports = { db, DATA_DIR, UPLOADS_DIR };
