import { NextResponse, type NextRequest } from 'next/server'
import { AUTH_COOKIE, isAuthenticated } from '@/lib/auth'

/**
 * 登录门锁（docs/技术栈构建与说明.md 第 5 节 · docs/实施文档.md S11）。
 *
 * 一件事：没登录就进不去。两种出口——
 *   · 页面请求  → 303 到 /login（带上原来的地址，登录后跳回去）
 *   · API 请求  → 401 JSON。**不能给 API 返回登录页 HTML** ——
 *                 前端 fetch 拿到 200 + 一坨 HTML 是最难排查的一类"假成功"
 *
 * 不拦静态资源与登录接口本身，否则登录页自己也会被挡住（白屏）。
 * 这里**不做**租户校验：租户边界在 service 层按下不表（三条铁律第 2 条）。
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE)?.value
  if (await isAuthenticated(token)) return NextResponse.next()

  const { pathname, search } = req.nextUrl

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  if (pathname !== '/') url.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(url)
}

export const config = {
  // api/health 也放行：给探活/监控用，不返回任何业务数据（挡上它会让容器探活误判）
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|api/auth|api/health).*)'],
}
