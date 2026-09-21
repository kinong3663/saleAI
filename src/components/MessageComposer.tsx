'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 「新增客户消息」输入框 —— Demo 的主入口。
 * 每条消息带一个 clientMsgId：真实场景里网络重试/用户连点不该写成两条记录，
 * 兜底靠的是 messages(customerId, clientMsgId) 的唯一约束。
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
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const text = content.trim()
    if (!text || pending) return

    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/customers/${customerId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          role: 'CUSTOMER',
          content: text,
          clientMsgId: crypto.randomUUID(),
        }),
      })
      if (!res.ok) {
        setError(`发送失败（HTTP ${res.status}）`)
        return
      }
      setContent('')
      router.refresh()
    } catch {
      setError('网络错误，请重试')
    } finally {
      setPending(false)
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
          {pending ? '发送中…' : '以客户身份发送'}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </form>
  )
}
