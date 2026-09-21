import Link from 'next/link'
import { notFound } from 'next/navigation'
import { TenantConfigForm } from '@/components/TenantConfigForm'
import { TenantSwitcher } from '@/components/TenantSwitcher'
import { getTenantDetail } from '@/server/services/tenant.service'
import { listTenants } from '@/server/services/tenant.service'

export const dynamic = 'force-dynamic'

/**
 * 租户配置页（技术栈文档 §5.2 / 配置改造.md §5）。
 *
 * 配置是**每次判定现读**的 —— 这里改完，下一次 AI 判定立刻用新配置，不需要重启、不需要重新部署。
 */
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
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href={`/customers?tenantId=${current.id}`}
        className="text-sm text-blue-600 hover:underline"
      >
        ← 返回客户列表
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">租户配置</h1>
          <p className="mt-1 text-xs text-slate-500">
            改完保存即刻生效 —— 下一次 AI 判定就会用新配置（不需要重启或重新部署）。
          </p>
        </div>
        <TenantSwitcher
          tenants={tenants}
          currentTenantId={current.id}
          basePath="/settings/tenant"
        />
      </div>

      <TenantConfigForm tenant={detail} />
    </main>
  )
}
