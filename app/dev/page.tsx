import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DevTools, type DevCustomerOption } from '@/components/DevTools'
import { isForceFailure } from '@/server/agent/llm'
import { listCustomers } from '@/server/services/customer.service'
import { listTenants } from '@/server/services/tenant.service'

export const dynamic = 'force-dynamic'

/**
 * S9 · /dev 调试工具页。
 *
 * 生产环境隐藏（决策记录第 3 节假设③ / 技术栈文档 5.2）：`NODE_ENV === 'production'` 直接 404。
 * ⚠️ 隐藏 ≠ 安全：这一页没有独立鉴权，它背后的三个 API 在生产里也是通的。
 * 真正的门锁是 S11 的单口令登录 —— 在那之前不要把带 /dev 的地址公开给不该用的人。
 */
export default async function DevPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  const tenants = await listTenants()
  const perTenant = await Promise.all(
    tenants.map(async (t) => {
      const customers = await listCustomers(t.id)
      return customers.map<DevCustomerOption>((c) => ({
        id: c.id,
        name: c.name,
        tenantId: t.id,
        tenantName: t.name,
        leadStage: c.state?.leadStage ?? null,
        needHuman: c.state?.needHuman ?? false,
      }))
    }),
  )
  const customers = perTenant.flat()

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/customers" className="text-sm text-blue-600 hover:underline">
        ← 返回客户列表
      </Link>

      <h1 className="mt-4 text-xl font-semibold">/dev 调试工具</h1>
      <p className="mt-1 text-xs text-slate-500">
        演示用的三个工具。生产环境（NODE_ENV=production）本页不可见。
      </p>

      <DevTools forceFailure={isForceFailure()} customers={customers} />
    </main>
  )
}
