//
// 登录门锁的共享逻辑（依据 docs/技术栈构建与说明.md 第 5 节、docs/实施文档.md S11）。
//
// 设计要点，和文档保持一致：
//   · 没有用户表、没有会话表 —— 这是一道挡随机路人的门，不是身份系统
//   · cookie 里存 sha256(账号:口令)，不存明文（实施文档 S11 明文要求）
//   · 口令只在服务端读，绝不用 NEXT_PUBLIC_ 前缀（技术栈文档第 7 节）
//
// 与文档唯一的差异（用户 2026-09-21 明确要求）：门锁带账号，不只是口令。
// 账号默认 salesadmin、口令默认 goodsales，线上用 APP_USER / APP_PASSWORD 覆盖。
// 仍然不引入用户表：账号只是口令之外的第二道固定串，不承担身份/权限语义。
//

export const AUTH_COOKIE = 'zigoai_auth'

/** 7 天免登录（实施文档 S11 验收：关掉无痕再开，7 天内不用重复登录） */
export const AUTH_MAX_AGE = 7 * 24 * 60 * 60

const DEFAULT_USER = 'salesadmin'
const DEFAULT_PASSWORD = 'goodsales'

export function authUser(): string {
  return (process.env.APP_USER ?? '').trim() || DEFAULT_USER
}

/**
 * 口令来源：环境变量优先。
 * 用 `||` 而不是 `??`：.env 里写了 `APP_PASSWORD=`（空值）时也要回落到默认口令 ——
 * 空口令开门锁比默认口令更糟。
 */
export function authPassword(): string {
  return (process.env.APP_PASSWORD ?? '').trim() || DEFAULT_PASSWORD
}

/**
 * cookie 的值 = sha256(账号:口令) 的十六进制。
 *
 * 用 Web Crypto（crypto.subtle）而不是 node:crypto：middleware 跑在 Edge runtime，
 * 那里没有 node:crypto。这份实现要能同时被 middleware 和 Node 的 route handler 调用。
 */
export async function authToken(): Promise<string> {
  const bytes = new TextEncoder().encode(`${authUser()}:${authPassword()}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 定长比较：不要用 === 比 hash（虽然这里风险很低，但没理由留个坏习惯） */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function isAuthenticated(token: string | undefined | null): Promise<boolean> {
  if (!token) return false
  return safeEqual(token, await authToken())
}

/** 登录成功后跳哪里：只接受站内相对路径，挡掉 //evil.com 这类开放重定向 */
export function safeNextPath(next: string | undefined | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/customers'
  return next
}
