#!/bin/sh
# S6 · 容器启动脚本
# 顺序很重要：先把迁移打完，再让服务对外提供请求。否则第一个请求会撞上还没建表的库。
set -e

echo "[entrypoint] prisma migrate deploy"
npx prisma migrate deploy

# 租户是两个「参考数据」：没有它们，界面连租户切换器都是空的。
# SEED_ONLY_IF_EMPTY=true 时只有库里一条租户都没有才写 —— 服务器重启不会覆盖演示时现场改的规则。
if [ "${SEED_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] ensure tenants (seed, skipped when already present)"
  SEED_ONLY_IF_EMPTY=true npx tsx prisma/seed.ts
fi

echo "[entrypoint] starting: $*"
exec "$@"
