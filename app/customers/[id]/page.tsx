import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AnalysisWatcher } from '@/components/AnalysisWatcher'
import { AnalyzePanel } from '@/components/AnalyzePanel'
import { AppHeader } from '@/components/AppHeader'
import { ChatScroll } from '@/components/ChatScroll'
import { LogoutButton } from '@/components/LogoutButton'
import { MessageComposer } from '@/components/MessageComposer'
import { ReopenButton } from '@/components/ReopenButton'
import { StageBadge } from '@/components/StageBadge'
import { StageTimeline } from '@/components/StageTimeline'
import { SuggestionCard } from '@/components/SuggestionCard'
import { isTerminalStage, type LeadStage } from '@/lib/constants'
import { formatDateTime } from '@/lib/datetime'
import { getLatestAgentRun, getRecentAgentRuns } from '@/server/agent/analyze'
import { getCustomer } from '@/server/services/customer.service'
import { getTenant } from '@/server/services/tenant.service'

export const dynamic = 'force-dynamic'

const HEADER_ACTION =
  'rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-100'

//
// 会话工作台 —— 三栏，占满一屏，页面本身不滚动。
//
//   ┌──────────┬────────────────────────┬──────────────┐
//   │ 客户信息  │ 聊天记录（自己滚）      │ AI 窗口       │
//   │ 阶段时间线│                        │ 判定进度/建议  │
//   │ （不动）  │ [输入框固定在这一栏底部] │ 手动重判      │
//   └──────────┴────────────────────────┴──────────────┘
//
// 为什么改成"各自滚"而不是整页滚：这是操作台，销售一边打字一边看建议。
// 整页滚动会把左栏的客户状态、右栏的 AI 建议一起滚出视野 —— 每次都要找回来。
// 现在只有中间的对话在动，另外两栏钉在原地（左侧 min-h-0 + overflow-y-auto 独立滚）。
//
// 没有 tenantId 时不在全库范围里按 id 反查 —— 那等于绕过租户边界，直接回列表页让用户先选租户。
//
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

  // 最近这条客户消息有没有对应的判定？没有就说明「客户刚发进聊天、AI 还在跑」——
  // 右侧据此显示"正在分析"并自动刷新。判定依据是"消息落库并被判定"，不是"有没有人点过按钮"。
  const judgedMessageIds = new Set(
    recentRuns.map((r) => r.triggerMessageId).filter((x): x is string => Boolean(x)),
  )
  const pendingMessageId =
    lastCustomerMessage && !judgedMessageIds.has(lastCustomerMessage.id)
      ? lastCustomerMessage.id
      : null

  const lastMessage = customer.messages[customer.messages.length - 1] ?? null

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <AppHeader subtitle={customer.name}>
        <Link href={`/customers?tenantId=${tenant.id}`} className={HEADER_ACTION}>
          ← 客户列表
        </Link>
        <Link href={`/settings/tenant?tenantId=${tenant.id}`} className={HEADER_ACTION}>
          用户配置
        </Link>
        <LogoutButton />
      </AppHeader>

      <main className="mx-auto grid w-full max-w-[1600px] flex-1 grid-cols-1 gap-4 overflow-hidden px-6 py-4 lg:grid-cols-[290px_minmax(0,1fr)_380px]">
        {/* ── 左：客户信息 + 阶段时间线（内容与之前一致，只跟着新骨架排版） ── */}
        <aside className="min-h-0 space-y-4 overflow-y-auto overscroll-contain pr-1">
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h1 className="text-base font-semibold tracking-tight">{customer.name}</h1>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-slate-500">阶段</span>
                <StageBadge stage={customer.state?.leadStage ?? null} />
              </div>
              <Row label="最近意图" value={customer.state?.intent ?? '—'} />
              <Row label="已购买次数" value={`${customer.state?.purchaseCount ?? 0} 次`} />
              <div className="flex justify-between">
                <span className="text-slate-500">是否需要人工</span>
                <span className={customer.state?.needHuman ? 'font-medium text-red-600' : ''}>
                  {customer.state?.needHuman ? '是' : '否'}
                </span>
              </div>
              <Row label="状态版本" value={String(customer.state?.version ?? 0)} />
              <Row label="最后互动" value={formatDateTime(customer.state?.lastActivityAt ?? '—')} />
              {customer.state?.humanResolvedAt && (
                <Row label="解除人工于" value={formatDateTime(customer.state.humanResolvedAt)} />
              )}
            </div>

            {isTerminalStage((customer.state?.leadStage ?? 'NEW') as LeadStage) && (
              <div className="mt-3">
                <ReopenButton tenantId={tenant.id} customerId={customer.id} />
              </div>
            )}

            <div className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-500">
              <div>租户：{tenant.name}</div>
              <div className="mt-1">渠道：{customer.channel}</div>
              <div className="mt-1">创建于 {formatDateTime(customer.createdAt)}</div>
              <div className="mt-1 break-all">客户 ID：{customer.id}</div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-medium">阶段时间线</h2>
            <div className="mt-3">
              <StageTimeline runs={recentRuns} />
            </div>
          </section>
        </aside>

        {/* ── 中：聊天记录（自己滚，输入框钉在这一栏底部） ── */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-medium">聊天记录</h2>
            <span className="text-xs text-slate-400">
              {customer.messages.length} 条 · 最近 50 条
            </span>
          </div>

          <ChatScroll watchKey={`${customer.messages.length}:${lastMessage?.id ?? ''}`}>
            {customer.messages.map((m) => (
              <div
                key={m.id}
                className={m.role === 'CUSTOMER' ? 'flex justify-start' : 'flex justify-end'}
              >
                <div
                  className={
                    m.role === 'CUSTOMER'
                      ? 'max-w-[75%] rounded-lg bg-slate-100 px-3 py-2'
                      : 'max-w-[75%] rounded-lg bg-blue-600 px-3 py-2 text-white'
                  }
                >
                  <div className="text-[11px] opacity-70">
                    {m.role === 'CUSTOMER' ? '客户' : m.role === 'SALES' ? '销售' : '系统'} ·{' '}
                    {formatDateTime(m.createdAt)}
                    {m.source !== 'manual' ? ` · ${m.source}` : ''}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                    {m.content}
                  </div>
                </div>
              </div>
            ))}

            {customer.messages.length === 0 && (
              <p className="py-10 text-center text-sm text-slate-500">
                还没有消息，在下面输入一条客户消息。
              </p>
            )}
          </ChatScroll>

          <MessageComposer tenantId={tenant.id} customerId={customer.id} />
        </section>

        {/* ── 右：AI 窗口 ── */}
        <div className="min-h-0 space-y-3 overflow-y-auto overscroll-contain pr-1">
          <AnalysisWatcher
            tenantId={tenant.id}
            customerId={customer.id}
            pendingMessageId={pendingMessageId}
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
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              还没有 AI 判定结果。发一条客户消息，系统会自动判定。
            </div>
          )}

          <AnalyzePanel
            tenantId={tenant.id}
            customerId={customer.id}
            triggerMessageId={lastCustomerMessage ? lastCustomerMessage.id : null}
          />
        </div>
      </main>
    </div>
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
