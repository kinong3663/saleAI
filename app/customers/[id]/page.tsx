import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { MessageComposer } from '@/components/MessageComposer'
import { StageBadge } from '@/components/StageBadge'
import { formatDateTime } from '@/lib/datetime'
import { getCustomer } from '@/server/services/customer.service'
import { getTenant } from '@/server/services/tenant.service'

export const dynamic = 'force-dynamic'

/**
 * 会话工作台（S2 先做两栏：客户信息 + 聊天记录；AI 建议卡片是 S3/S5 的事）。
 *
 * 没有 tenantId 时不在全库范围里按 id 反查 —— 那等于绕过租户边界。
 * 直接回列表页让用户先选租户。
 */
export default async function CustomerWorkbenchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tenantId?: string }>
}) {
  const [{ id }, { tenantId }] = await Promise.all([params, searchParams])
  if (!tenantId) redirect('/customers')

  const tenant = await getTenant(tenantId)
  if (!tenant) notFound()

  const customer = await getCustomer(tenantId, id)
  if (!customer) notFound()

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href={`/customers?tenantId=${tenant.id}`} className="text-sm text-blue-600 hover:underline">
        ← 返回客户列表
      </Link>

      <div className="mt-4 grid gap-6 md:grid-cols-[280px_1fr]">
        {/* 左栏：客户信息 */}
        <aside className="rounded border border-slate-200 bg-white p-4">
          <h1 className="text-lg font-semibold">{customer.name}</h1>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">阶段</span>
              <StageBadge stage={customer.state?.leadStage ?? null} />
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">最近意图</span>
              <span>{customer.state?.intent ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">是否需要人工</span>
              <span className={customer.state?.needHuman ? 'font-medium text-red-600' : ''}>
                {customer.state?.needHuman ? '是' : '否'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">最后互动</span>
              <span>{formatDateTime(customer.state?.lastActivityAt ?? '—')}</span>
            </div>
          </div>

          <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500">
            <div>租户：{tenant.name}</div>
            <div className="mt-1">渠道：{customer.channel}</div>
            <div className="mt-1">创建于 {formatDateTime(customer.createdAt)}</div>
            <div className="mt-1 break-all">客户 ID：{customer.id}</div>
          </div>
        </aside>

        {/* 右栏：聊天记录 */}
        <section className="rounded border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">聊天记录</h2>
            <span className="text-xs text-slate-400">
              共 {customer.messages.length} 条（最近 50 条）
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {customer.messages.map((m) => (
              <div
                key={m.id}
                className={m.role === 'CUSTOMER' ? 'flex justify-start' : 'flex justify-end'}
              >
                <div
                  className={
                    m.role === 'CUSTOMER'
                      ? 'max-w-[80%] rounded-lg bg-slate-100 px-3 py-2'
                      : 'max-w-[80%] rounded-lg bg-blue-600 px-3 py-2 text-white'
                  }
                >
                  <div className="text-xs opacity-70">
                    {m.role === 'CUSTOMER' ? '客户' : m.role === 'SALES' ? '销售' : '系统'} ·{' '}
                    {formatDateTime(m.createdAt)}
                    {m.source !== 'manual' ? ` · ${m.source}` : ''}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm">{m.content}</div>
                </div>
              </div>
            ))}

            {customer.messages.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-500">
                还没有消息，在下面输入一条客户消息。
              </p>
            )}
          </div>

          <MessageComposer tenantId={tenant.id} customerId={customer.id} />
        </section>
      </div>
    </main>
  )
}
