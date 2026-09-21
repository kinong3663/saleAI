import Link from 'next/link'
import { formatDateTime } from '@/lib/datetime'
import { NewCustomerForm } from '@/components/NewCustomerForm'
import { StageBadge } from '@/components/StageBadge'
import { TenantSwitcher } from '@/components/TenantSwitcher'
import { listCustomers } from '@/server/services/customer.service'
import { listTenants } from '@/server/services/tenant.service'

export const dynamic = 'force-dynamic'

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
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-xl font-semibold">还没有租户</h1>
        <p className="mt-3 text-sm text-slate-600">
          先跑一次 <code className="rounded bg-slate-100 px-1">npx prisma db seed</code> 初始化两个租户。
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">客户列表</h1>
          <p className="mt-1 text-xs text-slate-500">
            当前租户：{current.name}（{customers.length} 个客户）
          </p>
        </div>
        <TenantSwitcher tenants={tenants} currentTenantId={current.id} />
      </header>

      <NewCustomerForm tenantId={current.id} />

      <ul className="mt-8 divide-y divide-slate-200 rounded border border-slate-200 bg-white">
        {customers.map((c) => (
          <li key={c.id}>
            <Link
              href={`/customers/${c.id}?tenantId=${current.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-slate-50"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{c.name}</span>
                  <StageBadge stage={c.state?.leadStage ?? null} />
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
                <div className="mt-1">最后互动 {formatDateTime(c.state?.lastActivityAt ?? '—')}</div>
              </div>
            </Link>
          </li>
        ))}

        {customers.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-slate-500">
            这个租户还没有客户，用上面的表单新建一个。
          </li>
        )}
      </ul>
    </main>
  )
}
