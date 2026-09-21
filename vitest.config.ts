import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

/**
 * 把 .env 读进测试进程 —— Prisma 需要 DATABASE_URL。
 * 只有十几行，不值得为它引一个 dotenv 依赖。
 */
function loadDotEnv(): Record<string, string> {
  try {
    const out: Record<string, string> = {}
    for (const line of readFileSync(resolve(root, '.env'), 'utf8').split('\n')) {
      const matched = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (matched) out[matched[1]] = matched[2]
    }
    return out
  } catch {
    return {}
  }
}

export default defineConfig({
  resolve: {
    // 和 tsconfig 的 "@/*" 对齐，测试里就能用和源码一样的 import 路径
    alias: { '@': resolve(root, 'src') },
  },
  test: {
    environment: 'node',
    env: loadDotEnv(),
    // 集成测试会建/删自己的租户与客户，串行跑避免互相踩
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
