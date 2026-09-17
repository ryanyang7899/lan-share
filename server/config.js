'use strict';

module.exports = {
  // 服务监听端口
  PORT: Number(process.env.PORT || 8080),
  // 默认保留期：7 天（秒），前端可选 1/3/7/30 天或永久
  DEFAULT_TTL: 7 * 24 * 3600,
  // 单文件上传上限（MB）
  MAX_UPLOAD_MB: Number(process.env.MAX_UPLOAD_MB || 1024),
  // 过期清理任务间隔（毫秒）
  CLEANUP_INTERVAL: 30 * 60 * 1000,
  // 昵称最大长度
  NICK_MAX: 20,
  // 文字内容最大长度
  CONTENT_MAX: 4000,

  // ---------- 认证 ----------
  // 会话有效期：7 天
  SESSION_TTL: 7 * 24 * 3600 * 1000,
  // 会话 Cookie 名
  SESSION_COOKIE: 'ls_session',
  // 同一 IP 连续登录失败达到该次数即锁定
  LOGIN_MAX_FAILS: 5,
  // 锁定时长：24 小时
  LOGIN_LOCK_MS: 24 * 3600 * 1000,
  // 首次启动自动创建的管理员账户（可用环境变量覆盖）
  DEFAULT_ADMIN: {
    username: process.env.DEFAULT_ADMIN_USER || 'Ryan',
    password: process.env.DEFAULT_ADMIN_PASS || 'asDF1314',
  },
};
