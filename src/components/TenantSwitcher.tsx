'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { TenantDTO } from '@/lib/types'

// 顶部的租户选择。basePath 决定切换后跳回哪个页面（客户列表 / 租户配置）。
// 旁边那个「租户配置」入口是配置页的发现路径 —— 文档里它是个独立路由，得有地方点进去。
export function TenantSwitcher({
  tenants,
  currentTenantId,
  basePath = '/customers',
}: {
  tenants: TenantDTO[]
  currentTenantId: string
  basePath?: string
}) {
  const router = useRouter()
  const id = `tenant-switch-${currentTenantId.slice(-6)}`

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs text-slate-500">
        租户
      </label>
      <select
        id={id}
        value={currentTenantId}
        onChange={(e) => router.push(`${basePath}?tenantId=${e.target.value}`)}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <Link
        href={`/settings/tenant?tenantId=${currentTenantId}`}
        className="text-xs text-blue-600 hover:underline"
      >
        租户配置
      </Link>
    </div>
  )
}
