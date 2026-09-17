'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { randomUUID } = require('node:crypto');

const { db, UPLOADS_DIR } = require('../db');
const { MAX_UPLOAD_MB } = require('../config');

// 管理员可删任意文件，子账户仅限自己上传的
function canModify(req, row) {
  return req.user.role === 'admin' || row.uploader === req.user.username;
}

// 清理文件名里的路径与危险字符，仅用于落盘与展示
function safeName(name) {
  const base = path.basename(String(name || 'file'));
  return base.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 200);
}

async function filesRoutes(app) {
  // 文件列表（不返回磁盘路径）
  app.get('/api/files', async () => {
    return db
      .prepare('SELECT id, name, size, mime, uploader, created_at, expires_at FROM files ORDER BY created_at DESC')
      .all();
  });

  // 上传（multipart，流式落盘）
  app.post('/api/files', async (req, reply) => {
    const data = await req.file({ limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 } });

    const uploader = req.user.username; // 昵称与账户绑定，忽略客户端自报的 uploader
    const ttlRaw = data.fields.ttl && data.fields.ttl.value;
    const ttl = Number(ttlRaw) > 0 ? Number(ttlRaw) : null;

    const created_at = Date.now();
    const expires_at = ttl ? created_at + ttl * 1000 : null;
    const id = randomUUID();
    const diskName = `${id}-${safeName(data.filename)}`;
    const savePath = path.join(UPLOADS_DIR, diskName);

    try {
      await pipeline(data.file, fs.createWriteStream(savePath));
    } catch (err) {
      fs.rmSync(savePath, { force: true });
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: `文件超过 ${MAX_UPLOAD_MB}MB 上限` });
      }
      throw err;
    }

    const stat = fs.statSync(savePath);
    db.prepare(
      'INSERT INTO files (id, name, size, mime, uploader, created_at, expires_at, path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, safeName(data.filename), stat.size, data.mimetype, uploader, created_at, expires_at, diskName);

    return {
      id,
      name: safeName(data.filename),
      size: stat.size,
      mime: data.mimetype,
      uploader,
      created_at,
      expires_at,
    };
  });

  // 下载（流式）
  app.get('/files/:id/download', async (req, reply) => {
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
    if (!row) return reply.code(404).send({ error: '文件不存在或已过期' });

    const abs = path.join(UPLOADS_DIR, row.path);
    if (!fs.existsSync(abs)) return reply.code(404).send({ error: '文件已从磁盘丢失' });

    const encName = encodeURIComponent(row.name);
    // filename* 走 RFC5987（UTF-8 百分号编码，支持中文），filename 回退必须只含 ASCII，
    // 否则 Fastify 对 content-disposition 里的原始非 ASCII 字符抛 ERR_INVALID_CHAR（500）。
    const fallback = row.name.replace(/[^\x20-\x7e]/g, '_').slice(0, 150) || 'download';
    reply
      .header('Content-Type', row.mime || 'application/octet-stream')
      .header('Content-Length', row.size)
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encName}; filename="${fallback}"`);

    return reply.send(fs.createReadStream(abs));
  });

  // 删除（连带磁盘文件）
  app.delete('/api/files/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
    if (!row) return reply.code(404).send({ error: '文件不存在' });
    if (!canModify(req, row)) return reply.code(403).send({ error: '只能删除自己上传的文件' });

    fs.rmSync(path.join(UPLOADS_DIR, row.path), { force: true });
    db.prepare('DELETE FROM files WHERE id = ?').run(row.id);
    return { ok: true };
  });
}

module.exports = filesRoutes;
