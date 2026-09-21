'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export interface DevCustomerOption {
  id: string
  name: string
  tenantId: string
  tenantName: string
  leadStage: string | null
  needHuman: boolean
}

interface ScanFollowedUp {
  customerName: string
  waitedHours: number
  status: string
  reply: string
  customerId: string
  tenantId: string
}

interface ScanResult {
  scannedStates: number
  followedUp: ScanFollowedUp[]
  skipped: { customerName: string; reason: string }[]
  failed: { customerId: string; error: string }[]
}

/**
 * S9 · 三个调试工具（演示用）。
 * 每个工具都只是对应 API 的一层界面：强制 AI 故障 / 时间快进 / 手动触发跟进扫描。
 */
export function DevTools({
  forceFailure,
  customers,
}: {
  forceFailure: boolean
  customers: DevCustomerOption[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [hours, setHours] = useState(72)
  const [targetCustomerId, setTargetCustomerId] = useState(customers[0]?.id ?? '')
  const [scan, setScan] = useState<ScanResult | null>(null)

  async function call(label: string, url: string, body?: unknown) {
    setBusy(label)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(`${label} 失败（HTTP ${res.status}）`)
        return null
      }
      return data
    } catch (e) {
      setError(`${label} 失败：${e instanceof Error ? e.message : String(e)}`)
      return null
    } finally {
      setBusy(null)
    }
  }

  async function toggleFailure(next: boolean) {
    const data = (await call('切换故障开关', '/api/dev/force-failure', { enabled: next })) as
      | { enabled: boolean }
      | null
    if (data) {
      setMessage(`强制 AI 故障已${data.enabled ? '打开' : '关闭'}（立即生效，不需要重启）`)
      router.refresh()
    }
  }

  async function advanceTime() {
    const data = (await call('时间快进', '/api/dev/advance-time', {
      hours,
      customerId: targetCustomerId || undefined,
    })) as { updated: number; hours: number } | null
    if (data) {
      setMessage(`已把 ${data.updated} 个客户的 lastActivityAt 往前拨 ${data.hours} 小时`)
      router.refresh()
    }
  }

  async function runScan() {
    const data = (await call('触发扫描', '/api/followups/scan')) as ScanResult | null
    if (data) {
      setScan(data)
      setMessage(
        `扫描完成：看了 ${data.scannedStates} 个客户状态，生成 ${data.followedUp.length} 条跟进建议`,
      )
      router.refresh()
    }
  }

  return (
    <div className="mt-6 space-y-4">
      {/* 工具 1 · 强制 AI 故障 */}
      <section className="rounded border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">① 强制 AI 故障</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              forceFailure ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
            }`}
          >
            {forceFailure ? '已打开' : '已关闭'}
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          打开后 `callLLM` 直接返回失败、不真的发请求。预期效果：判定变成 <code>FALLBACK</code>
          （状态不前进 + need_human=true + 转人工话术），页面显示降级提示而不是报错。
          不要用断网来演示 —— 现场不可控。
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => toggleFailure(true)}
            disabled={busy !== null || forceFailure}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            {busy === '切换故障开关' ? '处理中…' : '打开故障'}
          </button>
          <button
            type="button"
            onClick={() => toggleFailure(false)}
            disabled={busy !== null || !forceFailure}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 disabled:opacity-40"
          >
            关闭故障
          </button>
        </div>
      </section>

      {/* 工具 2 · 时间快进 */}
      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="font-medium">② 时间快进</h2>
        <p className="mt-2 text-xs text-slate-500">
          把客户的 <code>lastActivityAt</code> / <code>lastFollowUpAt</code> 往前拨，模拟「沉默了很久」。
          只拨这两个字段 —— 「客户没回我 vs 我还没回客户」的先后关系（决策 Q7）不能被拨变形。
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="dev-target" className="text-xs text-slate-500">
              目标客户
            </label>
            <select
              id="dev-target"
              value={targetCustomerId}
              onChange={(e) => setTargetCustomerId(e.target.value)}
              className="h-9 min-w-[22rem] rounded border border-slate-300 bg-white px-2 text-sm"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  [{c.tenantName}] {c.name} · {c.leadStage ?? '未判定'}
                  {c.needHuman ? ' · 待人工' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="dev-hours" className="text-xs text-slate-500">
              往前拨（小时）
            </label>
            <input
              id="dev-hours"
              type="number"
              min={1}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="h-9 w-28 rounded border border-slate-300 bg-white px-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={advanceTime}
            disabled={busy !== null || !targetCustomerId}
            className="h-9 rounded bg-blue-600 px-3.5 text-sm text-white disabled:opacity-40"
          >
            {busy === '时间快进' ? '拨动中…' : '快进时间'}
          </button>
        </div>
      </section>

      {/* 工具 3 · 手动触发跟进扫描 */}
      <section className="rounded border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">③ 手动触发跟进扫描</h2>
          <button
            type="button"
            onClick={runScan}
            disabled={busy !== null}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            {busy === '触发扫描' ? '扫描中…' : '触发扫描'}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          和进程内 60 秒定时器共用同一个 <code>runFollowUpScan()</code>（决策 Q6）。
          重复点不会重复生成 —— 幂等靠 `followUpCount` 的 CAS，不靠「扫描只跑一次」。
        </p>

        {scan && (
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-xs text-slate-500">
              看了 {scan.scannedStates} 个客户状态 · 生成 {scan.followedUp.length} 条 · 跳过{' '}
              {scan.skipped.length} 条 · 失败 {scan.failed.length} 条
            </p>
            {scan.followedUp.map((f) => (
              <div key={f.customerId} className="rounded border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-medium text-emerald-900">
                  ✓ {f.customerName}（沉默 {f.waitedHours}h · {f.status}）
                </p>
                <p className="mt-1 text-sm text-emerald-900">{f.reply}</p>
                <Link
                  href={`/customers/${f.customerId}?tenantId=${f.tenantId}`}
                  className="mt-1 inline-block text-xs text-emerald-800 underline"
                >
                  去看这个客户的建议卡片 →
                </Link>
              </div>
            ))}
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer">跳过明细（{scan.skipped.length} 条）</summary>
              <ul className="mt-1 space-y-0.5">
                {scan.skipped.map((s) => (
                  <li key={s.customerName}>
                    {s.customerName} —— {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </section>

      {message && <p className="text-sm text-emerald-700">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
