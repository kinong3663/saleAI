import { redirect } from 'next/navigation'
import { LoginForm } from '@/components/LoginForm'
import { AUTH_COOKIE, isAuthenticated, safeNextPath } from '@/lib/auth'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

/**
 * 登录页（middleware 放行，见 middleware.ts 的 matcher）。
 *
 * 已经登录的人再打开 /login 就直接进工作台 —— 免得出现"登录了但停在登录页"的迷惑状态。
 *
 * 页面上**不显示**演示账号口令：凭据只来自 APP_USER / APP_PASSWORD（演示值写在交付说明里）。
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const target = safeNextPath(next)

  const jar = await cookies()
  if (await isAuthenticated(jar.get(AUTH_COOKIE)?.value)) redirect(target)

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight">salesAI</h1>
      <p className="mt-1 text-sm text-slate-500">销售工作台</p>
      <p className="mt-3 text-sm text-slate-600">
        请输入账号与密码。登录状态保留 7 天，期间不用重复登录。
      </p>

      <LoginForm next={target} />
    </main>
  )
}
