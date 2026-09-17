# 局域网共享系统（lan-share）

跨平台的文件 + 文字共享系统，部署在一台常开的 NAS / 服务器上，局域网内所有设备（电脑 / 手机 / 平板）用浏览器即可访问，无需安装任何客户端。

## 功能

- **📋 公告板**：共享文字 / 链接 / 笔记，按时间倒序，可删除，10 秒自动刷新
- **📁 文件**：拖拽或点击上传，流式下载，一键复制直链
- **💬 聊天**：局域网实时聊天室（WebSocket），断线自动重连，进房补最近 50 条历史
- **✅ Markdown**：输入框和展示框都支持 Markdown 渲染，长文本自动折叠、代码块一键复制
- **⏰ 过期清理**：每条消息 / 公告 / 文件可设保留期（1/3/7/30 天或永久），发送后也能随时改，服务端自动清理过期数据，防止 NAS 磁盘膨胀
- **🔐 登录认证**：全站需登录才能访问（含 WebSocket），scrypt 加盐哈希存密码，会话 Cookie 有效期 7 天
- **👤 账户管理**：管理员可增删子账户、重置密码、手动解锁 IP；普通用户可改自己的密码
- **🛡️ 防爆破锁定**：同一 IP 连续登录失败 5 次，锁定 24 小时
- **😀 昵称与账户绑定**：昵称直接取账户名，服务端强制覆盖客户端上报值，无法冒名

## 下载

### 方式一：git clone（推荐，便于更新）

```bash
git clone https://github.com/<你的用户名>/lan-share.git
cd lan-share
```

### 方式二：下载 zip 压缩包

GitHub 仓库页面 → 绿色 **Code** 按钮 → **Download ZIP**，解压后进入目录即可。

> 后续更新：本地改完代码后 `git pull` 同步（或用新的 ZIP 覆盖），重新构建镜像即可。

## 安装运行

### 方式一：Docker（推荐，NAS / 服务器）

要求：已安装 Docker 与 Docker Compose（NAS 一般自带或可安装）。

```bash
cd lan-share

# 构建并启动
docker compose up -d --build
```

浏览器访问 `http://<NAS的IP>:8090`（手机等局域网设备同网段即可访问），会跳转到登录页。

### 首次登录

首次启动时会自动创建管理员账户：

| 账户名 | 密码 |
|---|---|
| `Ryan` | `asDF1314` |

> ⚠️ **部署后请立刻登录，在「👤 账户」页修改管理员密码。** 默认密码是公开写在仓库里的，不改等于没有防护。
> 也可以用环境变量 `DEFAULT_ADMIN_USER` / `DEFAULT_ADMIN_PASS` 覆盖默认值（仅在数据库里没有任何账户时生效）。

登录后可在「👤 账户」标签页：改自己的密码；管理员额外能新建 / 删除子账户、重置子账户密码、查看并手动解锁被锁定的 IP。

数据持久化在 `./data/`（SQLite 数据库 + 上传文件），容器重建数据不丢。停止服务用 `docker compose down`。

### 方式二：直接运行 Node.js（本地开发 / 无 Docker 环境）

要求：Node.js ≥ 18（better-sqlite3 需要编译工具链，建议 Node 20 LTS）。

```bash
cd lan-share
npm install
npm start        # 默认监听 8080
```

浏览器访问 `http://localhost:8080`。

## 配置（环境变量）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | 服务监听端口（compose 里映射为 8090） |
| `DATA_DIR` | `./data` | 数据目录（数据库 + 上传文件） |
| `MAX_UPLOAD_MB` | `1024` | 单文件上传上限（MB） |
| `DEFAULT_ADMIN_USER` | `Ryan` | 初始管理员账户名（仅首次启动、库中无账户时生效） |
| `DEFAULT_ADMIN_PASS` | `asDF1314` | 初始管理员密码（同上，**强烈建议改掉**） |

> 锁定策略（失败次数 5 次 / 冷却 24 小时 / 会话 7 天）写在 [server/config.js](server/config.js) 里，可按需调整。

端口映射修改：编辑 `docker-compose.yml` 里 `ports` 的左侧值（如 `"8090:8080"` → `"9000:8080"`）。

## 常见问题

- **构建失败：Docker Hub 不可达**：部分网络环境下拉取 `node:20-slim` 基础镜像会超时（`dial tcp registry-1.docker.io:443: i/o timeout`）。可换 DaoCloud 加速器：

  ```bash
  # 方式一：先拉再打 tag（无需改配置）
  docker pull docker.m.daocloud.io/library/node:20-slim
  docker tag docker.m.daocloud.io/library/node:20-slim node:20-slim
  docker compose up -d --build

  # 方式二：永久配置镜像加速器
  # 编辑 /etc/docker/daemon.json：
  #   { "registry-mirrors": ["https://docker.m.daocloud.io"] }
  # 然后重启 docker
  ```

- **手机访问不了**：确认手机与 NAS 在同一局域网，访问 `http://<NAS的IP>:8090`，并确认 NAS 防火墙放行 8090 端口
- **端口冲突**：改 `docker-compose.yml` 里的端口映射
- **Docker 权限报错**：部分系统需要使 `docker` 命令前加 `sudo`，或用 `sg docker -c "..."` 执行

## API 一览

```
GET    /api/health                 健康检查（免登录）
POST   /api/login                  登录 {username, password}
POST   /api/logout                 登出
GET    /api/me                     当前登录用户
POST   /api/me/password            改自己的密码 {oldPassword, newPassword}

GET    /api/users                  子账户列表（管理员）
POST   /api/users                  新建子账户（管理员）{username, password}
DELETE /api/users/:id              删除子账户（管理员）
POST   /api/users/:id/password     重置子账户密码（管理员）
GET    /api/locked-ips             被锁定的 IP 列表（管理员）
DELETE /api/locked-ips/:ip         手动解锁某个 IP（管理员）

GET    /api/posts                  公告板列表
POST   /api/posts                  发布公告板 {content, ttl?}
PATCH  /api/posts/:id              修改公告板时限 {ttl}
DELETE /api/posts/:id              删除公告板（本人或管理员）
GET    /api/files                  文件列表
POST   /api/files                  上传文件 (multipart: file, ttl?)
GET    /files/:id/download         下载文件（流式）
DELETE /api/files/:id              删除文件（本人或管理员）
GET    /api/chat (WebSocket)       聊天室（需携带会话 Cookie）
```

> 除 `/api/health` 和登录页静态资源外，所有接口与 WebSocket 均需登录。`author` / `uploader` 由服务端从会话推导，客户端传入会被忽略。