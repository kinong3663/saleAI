'use client'

import { useRouter } from 'next/navigation'
import type { TenantDTO } from '@/lib/types'

/** 顶部租户切换器：换租户 = 换 URL 上的 tenantId，页面重新按新租户取数 */
export function TenantSwitcher({
  tenants,
  currentTenantId,
}: {
  tenants: TenantDTO[]
  currentTenantId: string
}) {
  const router = useRouter()

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-slate-500">租户</span>
      <select
        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
        value={currentTenantId}
        onChange={(e) => router.push(`/customers?tenantId=${e.target.value}`)}
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  )
}
