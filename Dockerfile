# 基于 Debian 的 slim 镜像（better-sqlite3 有预编译产物，避免 alpine 编译）
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080 \
    DATA_DIR=/app/data

EXPOSE 8080
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
