'use strict';

const path = require('node:path');
const fs = require('node:fs');

const { db, UPLOADS_DIR } = require('./db');
const { CLEANUP_INTERVAL } = require('./config');
const { removeExpiredMessages } = require('./routes/chat');
const { cleanupAuth } = require('./auth');

// 删除过期记录与对应磁盘文件，返回删除数量
function cleanupOnce() {
  const now = Date.now();
  let removedPosts = 0;
  let removedFiles = 0;
  const removedMessages = removeExpiredMessages();

  const posts = db
    .prepare('SELECT id FROM posts WHERE expires_at IS NOT NULL AND expires_at < ?')
    .all(now);
  if (posts.length) {
    const stmt = db.prepare('DELETE FROM posts WHERE id = ?');
    const del = db.transaction((rows) => {
      for (const r of rows) stmt.run(r.id);
    });
    del(posts);
    removedPosts = posts.length;
  }

  const rows = db
    .prepare('SELECT id, path FROM files WHERE expires_at IS NOT NULL AND expires_at < ?')
    .all(now);
  if (rows.length) {
    const stmt = db.prepare('DELETE FROM files WHERE id = ?');
    const del = db.transaction((items) => {
      for (const r of items) {
        fs.rmSync(path.join(UPLOADS_DIR, r.path), { force: true });
        stmt.run(r.id);
      }
    });
    del(rows);
    removedFiles = rows.length;
  }

  const auth = cleanupAuth(); // 过期会话 + 冷却结束的锁定记录

  if (removedPosts + removedFiles + removedMessages > 0) {
    console.log(
      `[cleanup] 已清理：公告板 ${removedPosts} 条，聊天消息 ${removedMessages} 条，文件 ${removedFiles} 个`
    );
  }
  return { removedPosts, removedFiles, removedMessages, ...auth };
}

function startCleanup() {
  cleanupOnce();
  const timer = setInterval(cleanupOnce, CLEANUP_INTERVAL);
  timer.unref();
  return timer;
}

module.exports = { startCleanup, cleanupOnce };
