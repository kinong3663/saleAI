'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 重新激活 —— 终态锁（G1）的人工出口。
 *
 * 用在：客户已经「成交」或「流失」之后又回来咨询（复购、转介绍、流失回流）。
 * 不加这个出口的话，阶段会永远停在终态、跟进扫描也会一直跳过这个客户，
 * 这条回来的线索在系统里等于不存在。
 *
 * 它**不会**顺手解除人工：那是另一个决定（棘轮有自己的出口），各留各的痕。
 */
export function ReopenButton({
  tenantId,
  customerId,
}: {
  tenantId: string
  customerId: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function onClick() {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch(`/api/customers/${customerId}/reopen`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      const data = (await res.json().catch(() => null)) as {
        from?: string
        state?: { leadStage?: string }
      } | null
      if (!res.ok) {
        setError(
          res.status === 409
            ? '这个客户不在成交/流失状态，不需要重新激活'
            : `重新激活失败（HTTP ${res.status}）`,
        )
        return
      }
      setNote(
        `已重新激活：${data?.from ?? '终态'} → ${data?.state?.leadStage ?? 'DISCOVERY'}，跟进次数已清零`,
      )
      router.refresh()
    } catch (e) {
      setError(`重新激活失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
      <div className="text-xs font-medium text-amber-900">这个客户已经在终态（成交 / 流失）</div>
      <p className="mt-1 text-xs text-amber-900/80">
        客户又回来咨询（复购、转介绍、回流）时：客户一发言，AI 判定就会让阶段重新流动 ——
        点这里是你人工接管的那条路：阶段放回 DISCOVERY，跟进次数清零。不会解除人工。
      </p>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="mt-2 rounded border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-800 disabled:opacity-50"
      >
        {busy ? '处理中…' : '重新激活'}
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {note && <p className="mt-2 text-xs text-emerald-700">{note}</p>}
    </div>
  )
}
