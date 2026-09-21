'use client'

import { useRouter } from 'next/navigation'
import type { TenantDTO } from '@/lib/types'

// 顶部的租户选择。basePath 决定切换后跳回哪个页面（客户列表 / 用户配置）。
// 「用户配置」入口不在这里 —— 它由各页面顶栏放在这个选择器右边（AppHeader 的动作插槽），
// 这样两个页面长得一样，也不会出现两个入口互相打架。
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
        className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-100"
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  )
}
