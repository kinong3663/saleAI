import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AnalyzePanel } from '@/components/AnalyzePanel'
import { MessageComposer } from '@/components/MessageComposer'
import { StageBadge } from '@/components/StageBadge'
import { StageTimeline } from '@/components/StageTimeline'
import { SuggestionCard } from '@/components/SuggestionCard'
import { formatDateTime } from '@/lib/datetime'
import { getLatestAgentRun, getRecentAgentRuns } from '@/server/agent/analyze'
import { getCustomer } from '@/server/services/customer.service'
import { getTenant } from '@/server/services/tenant.service'

export const dynamic = 'force-dynamic'

/**
 * 会话工作台：客户信息 + 聊天记录 + AI 建议卡片（技术栈文档 5.2 的三栏布局）。
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

  const [latestRun, recentRuns] = await Promise.all([
    getLatestAgentRun(tenantId, id),
    getRecentAgentRuns(tenantId, id, 8),
  ])

  // 「生成建议」的触发点 = 最近一条客户消息（也是幂等键）
  const reversed = [...customer.messages].reverse()
  const lastCustomerMessage = reversed.find((m) => m.role === 'CUSTOMER') ?? null

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Link
        href={`/customers?tenantId=${tenant.id}`}
        className="text-sm text-blue-600 hover:underline"
      >
        ← 返回客户列表
      </Link>

      <div className="mt-4 grid gap-6 md:grid-cols-[280px_minmax(0,1fr)_340px]">
        <aside className="space-y-4">
          <div className="rounded border border-slate-200 bg-white p-4">
            <h1 className="text-lg font-semibold">{customer.name}</h1>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">阶段</span>
                <StageBadge stage={customer.state?.leadStage ?? null} />
              </div>
              <Row label="最近意图" value={customer.state?.intent ?? '—'} />
              <div className="flex justify-between">
                <span className="text-slate-500">是否需要人工</span>
                <span className={customer.state?.needHuman ? 'font-medium text-red-600' : ''}>
                  {customer.state?.needHuman ? '是' : '否'}
                </span>
              </div>
              <Row label="状态版本" value={String(customer.state?.version ?? 0)} />
              <Row
                label="最后互动"
                value={formatDateTime(customer.state?.lastActivityAt ?? '—')}
              />
              {customer.state?.humanResolvedAt && (
                <Row
                  label="解除人工于"
                  value={formatDateTime(customer.state.humanResolvedAt)}
                />
              )}
            </div>

            <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500">
              <div>租户：{tenant.name}</div>
              <div className="mt-1">渠道：{customer.channel}</div>
              <div className="mt-1">创建于 {formatDateTime(customer.createdAt)}</div>
              <div className="mt-1 break-all">客户 ID：{customer.id}</div>
            </div>
          </div>

          <div className="rounded border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-medium">阶段时间线</h2>
            <div className="mt-3">
              <StageTimeline runs={recentRuns} />
            </div>
          </div>
        </aside>

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

        <div className="space-y-3">
          <AnalyzePanel
            tenantId={tenant.id}
            customerId={customer.id}
            triggerMessageId={lastCustomerMessage ? lastCustomerMessage.id : null}
          />

          {latestRun ? (
            // key=run.id：换了一条判定就重挂载，编辑框回到新的建议原文
            <SuggestionCard
              key={latestRun.id}
              run={latestRun}
              tenantId={tenant.id}
              customerId={customer.id}
              needHuman={customer.state?.needHuman ?? false}
              humanReason={customer.state?.humanReason ?? null}
            />
          ) : (
            <div className="rounded border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
              还没有 AI 判定结果。发一条客户消息，或点上面的按钮。
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}
