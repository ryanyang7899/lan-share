'use strict';

const { db } = require('../db');
const { NICK_MAX, CONTENT_MAX } = require('../config');

function parseAuthor(raw) {
  return String(raw || '匿名').trim().slice(0, NICK_MAX) || '匿名';
}
function parseContent(raw) {
  return String(raw || '').trim().slice(0, CONTENT_MAX);
}
// ttl 为秒数；<=0 或非法视为永久保留
function parseTTL(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function postsRoutes(app) {
  // 公告板列表（时间倒序，不含已过期）
  app.get('/api/posts', async () => {
    return db
      .prepare('SELECT * FROM posts WHERE expires_at IS NULL OR expires_at > ? ORDER BY created_at DESC')
      .all(Date.now());
  });

  // 发布一条
  app.post('/api/posts', async (req, reply) => {
    const body = req.body || {};
    const content = parseContent(body.content);
    if (!content) return reply.code(400).send({ error: '内容不能为空' });

    const author = parseAuthor(body.author);
    const created_at = Date.now();
    const ttl = parseTTL(body.ttl);
    const expires_at = ttl ? created_at + ttl * 1000 : null;

    const info = db
      .prepare('INSERT INTO posts (author, content, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(author, content, created_at, expires_at);

    return {
      id: info.lastInsertRowid,
      author,
      content,
      created_at,
      expires_at,
    };
  });

  // 设置/修改已发布公告的过期时限（ttl 为 0 或空 = 取消时限/永久）
  app.patch('/api/posts/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
    if (!row) return reply.code(404).send({ error: '公告不存在' });

    const body = req.body || {};
    const ttl = parseTTL(body.ttl);
    const expires_at = ttl ? Date.now() + ttl * 1000 : null;

    db.prepare('UPDATE posts SET expires_at = ? WHERE id = ?').run(expires_at, row.id);
    return { id: row.id, expires_at };
  });

  // 删除一条
  app.delete('/api/posts/:id', async (req, reply) => {
    const info = db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
    return { ok: info.changes > 0 };
  });
}

module.exports = postsRoutes;
