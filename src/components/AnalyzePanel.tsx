'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 触发 AI 判定的按钮。
 * 幂等由后端保证：同一条消息重复判定，返回的是同一条 AgentRun。
 */
export function AnalyzePanel({
  tenantId,
  customerId,
  triggerMessageId,
}: {
  tenantId: string
  customerId: string
  triggerMessageId: string | null
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function onRun() {
    if (!triggerMessageId || pending) return
    setPending(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch(`/api/customers/${customerId}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, triggerMessageId }),
      })
      const data = (await res.json().catch(() => null)) as {
        reused?: boolean
        ok?: boolean
        reason?: string | null
      } | null
      if (!res.ok) {
        setError(`判定失败（HTTP ${res.status}）`)
        return
      }
      if (data?.reused) setNote('这条消息已经判定过，直接复用上一条结果（幂等）')
      else if (data?.ok === false) setNote(`判定未成功：${data.reason ?? '未知原因'}`)
      router.refresh()
    } catch {
      setError('网络错误，请重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <button
        type="button"
        onClick={onRun}
        disabled={pending || !triggerMessageId}
        className="w-full rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
      >
        {pending ? 'AI 判定中…' : '生成 / 重新生成建议'}
      </button>
      {!triggerMessageId && (
        <p className="mt-2 text-xs text-slate-400">先发一条客户消息，才能触发判定。</p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
    </div>
  )
}
