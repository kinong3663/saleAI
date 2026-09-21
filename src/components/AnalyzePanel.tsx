'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

//
// 手动重试按钮 —— **不是**正常路径。
//
// 正常路径是：客户消息落库 → 服务端在响应之后自动判定（docs/消息触发时序.md）。
// 这个按钮只用于两种兜底：模型超时/失败后重试，或对旧消息重新判定。
// 幂等由后端保证：同一条消息重复判定，返回的是同一条 AgentRun。
//
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
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <button
        type="button"
        onClick={onRun}
        disabled={pending || !triggerMessageId}
        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40"
      >
        {pending ? 'AI 判定中…' : '手动重新判定'}
      </button>
      <p className="mt-2 text-xs text-slate-400">
        正常情况下不用点：客户一发消息，系统会自动判定（约 10~20 秒出结果，右侧会显示进度）。
      </p>
      {!triggerMessageId && (
        <p className="mt-2 text-xs text-slate-400">先发一条客户消息，才能触发判定。</p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
    </div>
  )
}
