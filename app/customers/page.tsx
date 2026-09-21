import Link from 'next/link'
import { AppHeader } from '@/components/AppHeader'
import { LogoutButton } from '@/components/LogoutButton'
import { NewCustomerForm } from '@/components/NewCustomerForm'
import { StageBadge } from '@/components/StageBadge'
import { TenantSwitcher } from '@/components/TenantSwitcher'
import { formatDateTime } from '@/lib/datetime'
import { listCustomers } from '@/server/services/customer.service'
import { listTenants } from '@/server/services/tenant.service'

export const dynamic = 'force-dynamic'

// 「用户配置」按钮的统一样式：顶栏里三个动作（租户切换 / 用户配置 / 退出登录）视觉权重一致，
// 都走"白底 + 细边 + hover 变底色"，主色只留给真正的主动作（发送、打开会话）。
const HEADER_ACTION =
  'rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-100'

//
// 客户列表（首页）。
//
// 顶栏分成两段：左端只有项目名，右端是"当前看的是哪个租户 + 它的配置 + 退出"。
// 「用户配置」紧挨租户选择 —— 它俩说的是同一件事（当前租户），分开摆会让人找。
//
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>
}) {
  const { tenantId } = await searchParams
  const tenants = await listTenants()
  const current = tenants.find((t) => t.id === tenantId) ?? tenants[0] ?? null
  const customers = current ? await listCustomers(current.id) : []

  if (!current) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <AppHeader />
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
          <h1 className="text-lg font-semibold">还没有租户</h1>
          <p className="mt-3 text-sm text-slate-600">
            先跑一次 <code className="rounded bg-slate-100 px-1">npx prisma db seed</code> 初始化两个租户。
          </p>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <AppHeader subtitle="客户列表">
        <TenantSwitcher tenants={tenants} currentTenantId={current.id} />
        <Link href={`/settings/tenant?tenantId=${current.id}`} className={HEADER_ACTION}>
          用户配置
        </Link>
        <LogoutButton />
      </AppHeader>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">客户列表</h1>
          <p className="text-xs text-slate-500">
            {current.name} · 共 {customers.length} 个客户
          </p>
        </div>

        <NewCustomerForm tenantId={current.id} />

        <ul className="mt-6 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {customers.map((c) => (
            <li key={c.id}>
              <Link
                href={`/customers/${c.id}?tenantId=${current.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    <StageBadge stage={c.state?.leadStage ?? null} />
                    {(c.state?.purchaseCount ?? 0) > 0 && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                        已购 {c.state?.purchaseCount} 次
                      </span>
                    )}
                    {c.state?.needHuman && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                        待人工
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    最近意图：{c.state?.intent ?? '—'} · 渠道：{c.channel}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-slate-400">
                  <div>更新于 {formatDateTime(c.updatedAt)}</div>
                  <div className="mt-1">
                    最后互动 {formatDateTime(c.state?.lastActivityAt ?? '—')}
                  </div>
                </div>
              </Link>
            </li>
          ))}

          {customers.length === 0 && (
            <li className="px-4 py-12 text-center text-sm text-slate-500">
              这个租户还没有客户，用上面的表单新建一个。
            </li>
          )}
        </ul>
      </main>
    </div>
  )
}
