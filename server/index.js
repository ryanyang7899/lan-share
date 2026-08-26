'use strict';

const path = require('node:path');
const Fastify = require('fastify');

const { PORT } = require('./config');
const postsRoutes = require('./routes/posts');
const filesRoutes = require('./routes/files');
const chatRoute = require('./routes/chat');
const { startCleanup } = require('./cleanup');

async function main() {
  const app = Fastify({ logger: true });

  // 托管前端静态文件
  await app.register(require('@fastify/static'), {
    root: path.join(__dirname, '..', 'public'),
  });

  await app.register(require('@fastify/websocket'));
  await app.register(require('@fastify/multipart'));

  await app.register(postsRoutes);
  await app.register(filesRoutes);
  await app.register(chatRoute);

  // 健康检查
  app.get('/api/health', async () => ({ ok: true, now: Date.now() }));

  startCleanup();

  await app.listen({ port: PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
