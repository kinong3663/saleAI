import { NextResponse, type NextRequest } from 'next/server'
import {
  AUTH_COOKIE,
  AUTH_MAX_AGE,
  authPassword,
  authToken,
  authUser,
  safeEqual,
} from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth —— 校验账号口令，种 cookie。
 *
 * cookie 里存的是 sha256(账号:口令)（实施文档 S11），不存明文：
 * 万一以后有人贴出 cookie，也拿不到口令本身。
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    user?: string
    password?: string
  } | null

  const user = (body?.user ?? '').trim()
  const password = body?.password ?? ''

  if (!safeEqual(user, authUser()) || !safeEqual(password, authPassword())) {
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true, user: authUser() })
  res.cookies.set({
    name: AUTH_COOKIE,
    value: await authToken(),
    httpOnly: true, // 前端 JS 读不到 —— 少一条 XSS 偷 cookie 的路
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_MAX_AGE,
    // 线上是 http://IP:8080 的明文地址，secure=true 会让浏览器直接丢掉这个 cookie。
    // 代价写在 README 的 Trade-offs 里：明文 HTTP 下 cookie 可被中间人看到。
    secure: false,
  })
  return res
}

/** DELETE /api/auth —— 退出登录（清掉 cookie，回登录页） */
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set({ name: AUTH_COOKIE, value: '', path: '/', maxAge: 0 })
  return res
}
