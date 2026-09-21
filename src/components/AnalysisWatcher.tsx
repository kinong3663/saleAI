'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/** 轮询间隔：判定本身要 3 秒防抖 + 模型 5~15 秒，2.5 秒一次足够灵敏又不吵 */
const POLL_MS = 2500
/** 兜底上限：超过这个时间还没结果就不再轮询，改提示用户手动重试 */
const MAX_WAIT_MS = 45_000

//
// 判定监听器 —— 「发完消息，右侧 AI 建议怎么还不出来」这个问题的正面解法。
//
// 背景：发送路径上**没有** AI 判定（依据 docs/消息触发时序.md）：写完消息立刻返回，
// 判定由服务端在响应之后跑（3 秒防抖 + 模型 5~15 秒）。这是刻意的 ——
// 模型的延迟不能变成「消息发不出去」。
//
// 但原来前端只是「发送后盲刷 4/8/14/20 秒」：模型慢一点就错过全部四次刷新，
// 卡片一直停在上一轮，页面上又没有任何提示 —— 看起来就像「AI 没生成」。
// 实测：判定平均约 11 秒落库，而盲刷四次只覆盖到 20 秒，中间没有任何可见状态。
//
// 现在改成：只要存在「客户发过、但还没有对应判定」的消息，
//   ① 立刻显示「AI 正在分析…已等 N 秒」，让等待可见；
//   ② 每 2.5 秒问一次 /runs，一出现对应判定就 router.refresh()，卡片自动换成新的；
//   ③ 超过 45 秒仍无结果 → 停下来提示，让用户点「运行判断」手动重试（不无限轮询）。
//
// pending 由服务端算好传进来（最近一条客户消息有没有 triggerMessageId 相同的 AgentRun），
// 所以这个组件不猜、也不轮询已经判定过的会话。
//
export function AnalysisWatcher({
  tenantId,
  customerId,
  pendingMessageId,
}: {
  tenantId: string
  customerId: string
  /** 还没有判定的那条客户消息 id；null 表示没有待判定的消息 */
  pendingMessageId: string | null
}) {
  const router = useRouter()
  const [elapsed, setElapsed] = useState(0)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (!pendingMessageId) return

    const startedAt = Date.now()
    let stopped = false
    setTimedOut(false)
    setElapsed(0)

    const tick = setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1000))
    }, 1000)

    const poll = setInterval(async () => {
      if (stopped) return
      if (Date.now() - startedAt > MAX_WAIT_MS) {
        stopped = true
        setTimedOut(true)
        return
      }
      try {
        const res = await fetch(`/api/customers/${customerId}/runs?tenantId=${tenantId}`, {
          cache: 'no-store',
        })
        if (!res.ok) return
        const data = (await res.json()) as { runs?: { triggerMessageId: string | null }[] }
        const judged = (data.runs ?? []).some((r) => r.triggerMessageId === pendingMessageId)
        if (judged) {
          stopped = true
          router.refresh()
        }
      } catch {
        // 网络抖一下就等下一轮，不打断用户
      }
    }, POLL_MS)

    return () => {
      stopped = true
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [pendingMessageId, tenantId, customerId, router])

  if (!pendingMessageId) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
      {timedOut ? (
        <span className="text-amber-700">
          等了 45 秒还没拿到判定结果（模型可能超时或调用失败）。点上面的「运行判断」可以手动重试。
        </span>
      ) : (
        <span className="flex items-center gap-2 text-slate-600">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          AI 正在分析这条消息…已等 {elapsed} 秒（通常 10~20 秒，结果会自动出现在下面）
        </span>
      )}
    </div>
  )
}
