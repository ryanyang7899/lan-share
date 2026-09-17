'use strict';

const path = require('node:path');
const Fastify = require('fastify');

const { PORT } = require('./config');
const postsRoutes = require('./routes/posts');
const filesRoutes = require('./routes/files');
const chatRoute = require('./routes/chat');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const { startCleanup } = require('./cleanup');
const { getSession, tokenFromReq, ensureDefaultAdmin } = require('./auth');

// 未登录也需放行的路径：登录页及其资源、登录接口、健康检查
const PUBLIC_PATHS = new Set([
  '/login.html',
  '/login.js',
  '/api/login',
  '/api/health',
  '/style.css',
  '/md.js',
  '/favicon.ico',
]);
function isPublic(pathname) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return pathname.startsWith('/vendor/'); // 登录页也要用 marked/DOMPurify
}

async function main() {
  const app = Fastify({ logger: true, trustProxy: true });

  // 托管前端静态文件
  await app.register(require('@fastify/static'), {
    root: path.join(__dirname, '..', 'public'),
  });

  await app.register(require('@fastify/websocket'));
  await app.register(require('@fastify/multipart'));

  // 全局鉴权：HTTP 与 WebSocket 升级请求都会经过此钩子
  app.addHook('onRequest', async (req, reply) => {
    const pathname = req.url.split('?')[0];
    if (isPublic(pathname)) return;

    const user = getSession(tokenFromReq(req));
    if (user) {
      req.user = user; // 后续路由据此确定昵称，忽略客户端自报的 author
      return;
    }

    // 页面请求跳登录页，接口请求返回 401 交给前端处理
    const wantsHtml = (req.headers.accept || '').includes('text/html');
    if (wantsHtml) return reply.redirect('/login.html');
    return reply.code(401).send({ error: '未登录', needLogin: true });
  });

  await app.register(authRoutes);
  await app.register(usersRoutes);
  await app.register(postsRoutes);
  await app.register(filesRoutes);
  await app.register(chatRoute);

  // 健康检查
  app.get('/api/health', async () => ({ ok: true, now: Date.now() }));

  ensureDefaultAdmin(); // 首次启动创建默认管理员
  startCleanup();

  await app.listen({ port: PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
