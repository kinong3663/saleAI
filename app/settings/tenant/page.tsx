import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AppHeader } from '@/components/AppHeader'
import { LogoutButton } from '@/components/LogoutButton'
import { TenantConfigForm } from '@/components/TenantConfigForm'
import { TenantSwitcher } from '@/components/TenantSwitcher'
import { getTenantDetail, listTenants } from '@/server/services/tenant.service'

export const dynamic = 'force-dynamic'

const HEADER_ACTION =
  'rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-100'

//
// 用户配置页（租户配置）。
//
// 只做排版优化：把"页面标题 + 一句话说明 + 租户切换"收成一条清楚的页头，
// 表单交给下面的大留白区域。配置是**每次判定现读**的 —— 改完保存，下一次 AI 判定立刻生效。
//
export default async function TenantSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>
}) {
  const { tenantId } = await searchParams
  const tenants = await listTenants()
  const current = tenants.find((t) => t.id === tenantId) ?? tenants[0] ?? null
  if (!current) notFound()

  const detail = await getTenantDetail(current.id)
  if (!detail) notFound()

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <AppHeader subtitle="用户配置">
        <TenantSwitcher tenants={tenants} currentTenantId={current.id} basePath="/settings/tenant" />
        <Link href={`/customers?tenantId=${current.id}`} className={HEADER_ACTION}>
          ← 客户列表
        </Link>
        <LogoutButton />
      </AppHeader>

      <main className="mx-auto w-full max-w-[1000px] flex-1 px-6 py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">用户配置</h1>
          <p className="text-xs text-slate-500">当前租户：{current.name}</p>
        </div>
        <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-slate-600">
          改完保存即刻生效，不需要重启或重新部署 —— 下一次 AI 判定就会用新配置。
          规则、阶段语义、转人工条件、产品与报价都按租户隔离，互不影响。
        </p>

        <div className="mt-6">
          <TenantConfigForm tenant={detail} />
        </div>
      </main>
    </div>
  )
}
