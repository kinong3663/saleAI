'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { randomId } from '@/lib/uuid'

/**
 * 「新增客户消息」输入框 —— Demo 的主入口。
 *
 * 发送路径上**没有 AI 判定**（依据 docs/消息触发时序.md）：写完消息就立刻回来，
 * 判定由服务端在响应之后按 B 路径跑（3 秒防抖 + 进程内锁）。
 * 所以按钮从"发送中…"到可用只有几百毫秒 —— 用户的发送体验不受模型速度影响。
 *
 * 建议卡片怎么自己出现：不在这个组件里做"盲刷"（原来盲刷 4/8/14/20 秒，
 * 模型慢一点就全错过，看起来像 AI 没反应）。改由右侧的 <AnalysisWatcher />
 * 盯着"这条消息还没有判定"，一出现结果就自动刷新页面。
 */
export function MessageComposer({
  tenantId,
  customerId,
}: {
  tenantId: string
  customerId: string
}) {
  const router = useRouter()
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const text = content.trim()
    if (!text || sending) return

    setError(null)
    setHint(null)
    setSending(true)
    try {
      const res = await fetch(`/api/customers/${customerId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          role: 'CUSTOMER',
          content: text,
          clientMsgId: randomId(),
        }),
      })
      if (!res.ok) {
        setError(`发送失败（HTTP ${res.status}）`)
        return
      }
      setContent('')
      router.refresh() // 消息立刻出现在接诊记录里；右侧同时出现"AI 正在分析"
      setHint('消息已发送 · AI 正在自动分析，结果会自己出现在右侧')
    } catch (e) {
      setError(`发送失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="border-t border-slate-200 bg-white px-4 py-3">
      <textarea
        className="w-full resize-none rounded border border-slate-300 bg-white px-3 py-2 text-sm transition-shadow focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none"
        rows={2}
        placeholder="输入一条客户消息，例如：那你们多少钱？"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={sending}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {sending ? '发送中…' : '以客户身份发送'}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
    </form>
  )
}
