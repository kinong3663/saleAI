# S6 · 部署产物
# 依据：docs/实施文档.md S6 —— entrypoint 第一件事是 prisma migrate deploy；
#       docs/技术栈构建与说明.md 8.1 —— compose 注入环境变量，镜像里不含任何 key。
#
# 为什么不用 Next 的 standalone 产物：容器里还要跑 prisma CLI（migrate）和 tsx（seed），
# standalone 需要手工挑 node_modules 子集，脆；直接带一份完整依赖更稳。
# 代价是镜像偏大 —— 24H 交付里这个取舍是划算的，README 的 Trade-offs 会写明。

FROM node:22-bookworm-slim AS builder

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Prisma 引擎需要 openssl
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# 构建期不需要数据库：所有页面都是 dynamic，没有静态预渲染的 DB 查询
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -r -g 1001 nextjs \
 && useradd -r -u 1001 -g nextjs nextjs

# 只搬运行期需要的东西：编译产物 + 依赖 + prisma（schema 与 migrations 必须进来，migrate deploy 要用）
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R nextjs:nextjs /app

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npx", "next", "start"]
