'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { randomId } from '@/lib/uuid'

/**
 * 「新增客户消息」输入框 —— Demo 的主入口。
 *
 * 两件事连在一起：写消息 → 触发 AI 判定 → 刷新页面。
 * 每条消息带一个 clientMsgId：真实场景里网络重试/用户连点不该写成两条记录，
 * 兜底靠的是 messages(customerId, clientMsgId) 的唯一约束。
 * ⚠️ clientMsgId 用 randomId() 而不是 crypto.randomUUID()：后者只在 https/localhost 存在。
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
  const [phase, setPhase] = useState<'idle' | 'sending' | 'analyzing'>('idle')
  const [error, setError] = useState<string | null>(null)

  const pending = phase !== 'idle'

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const text = content.trim()
    if (!text || pending) return

    setError(null)
    setPhase('sending')
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
      const data = (await res.json()) as { message: { id: string } }
      setContent('')

      // 消息落库之后紧接着触发判定（AI 调用在后端，不在数据库事务里）
      setPhase('analyzing')
      const analyzeRes = await fetch(`/api/customers/${customerId}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, triggerMessageId: data.message.id }),
      })
      if (!analyzeRes.ok) {
        setError(`消息已保存，但 AI 判定失败（HTTP ${analyzeRes.status}）`)
      }
      router.refresh()
    } catch (e) {
      // 不要把真实原因吞掉 —— 上次就是因为这里只显示「网络错误」，排查多绕了一圈
      setError(`发送失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPhase('idle')
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
      <div className="mt-2 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {phase === 'sending'
            ? '发送中…'
            : phase === 'analyzing'
              ? 'AI 判定中…'
              : '以客户身份发送'}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </form>
  )
}
