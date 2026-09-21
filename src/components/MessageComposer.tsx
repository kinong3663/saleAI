'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { randomId } from '@/lib/uuid'

/**
 * 「新增客户消息」输入框 —— Demo 的主入口。
 *
 * 发送路径上**没有 AI 判定**（依据 docs/消息触发时序.md）：写完消息就立刻回来，
 * 判定由服务端在响应之后按 B 路径跑（3 秒防抖 + 进程内锁）。
 * 所以按钮从"发送中…"到可用只有几百毫秒 —— 用户的发送体验不受模型速度影响。
 *
 * 建议卡片稍后自动出现：这里在发送后做几次有限刷新（不是长轮询），
 * 覆盖"3 秒防抖 + 模型 5~15 秒"这段窗口。想立刻看，也可以点上面的「运行判断」。
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
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    return () => {
      for (const t of timers.current) clearTimeout(t)
      timers.current = []
    }
  }, [])

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
      router.refresh() // 消息立刻出现在接诊记录里
      setHint('消息已发送 · AI 正在后台分析，建议卡片稍后自动出现')

      // 后台判定的典型耗时 = 3 秒防抖 + 模型 5~15 秒；做几次有限刷新覆盖这段窗口
      for (const delay of [4000, 8000, 14000, 20000]) {
        timers.current.push(setTimeout(() => router.refresh(), delay))
      }
    } catch (e) {
      setError(`发送失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 border-t border-slate-200 pt-4">
      <textarea
        className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
        rows={2}
        placeholder="输入一条客户消息，例如：那你们多少钱？"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={sending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {sending ? '发送中…' : '以客户身份发送'}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
    </form>
  )
}
