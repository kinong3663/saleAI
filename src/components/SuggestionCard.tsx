'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AgentRunDTO } from '@/lib/types'
import { formatDateTime } from '@/lib/datetime'
import { randomId } from '@/lib/uuid'
import { StageBadge } from './StageBadge'

const STATUS_STYLE: Record<string, string> = {
  SUCCESS: 'bg-emerald-100 text-emerald-700',
  REPAIRED: 'bg-amber-100 text-amber-800',
  FALLBACK: 'bg-red-100 text-red-700',
  FAILED: 'bg-red-100 text-red-700',
}

const ISSUE_LABEL: Record<string, string> = {
  terminal_stage_locked: '终态锁：阶段被压回上轮',
  stage_regression_blocked: '阶段单调：不允许回退',
  price_rule_violated: '报价规则：reply 里出现了具体价格',
  human_flag_action_mismatch: '转人工一致性：动作被强制为转人工',
  low_confidence_escalation: '低置信度 + 高风险：升级为人工',
  followup_advance_blocked: '跟进不推进阶段',
}

/**
 * AI 建议卡片：判断结果 + **可编辑的建议回复** + 发送 + 解除人工。
 *
 * 编辑后发送仍然记 source = ai_suggested；「改没改过」由后端拿内容和
 * AgentRun.output.reply 比出来（前端说了不算）。
 *
 * clientMsgId 每次「发送尝试」用同一个 id：双击或网络重试不会写成两条 SALES 消息
 * （服务端靠 messages(customerId, clientMsgId) 唯一约束兜底）。发送成功后换新 id，
 * 下一次发送才是另一条消息。
 */
export function SuggestionCard({
  run,
  tenantId,
  customerId,
  needHuman,
  humanReason,
}: {
  run: AgentRunDTO
  tenantId: string
  customerId: string
  needHuman: boolean
  humanReason: string | null
}) {
  const router = useRouter()
  const [draft, setDraft] = useState(run.output?.reply ?? '')
  const [sendId, setSendId] = useState(() => randomId())
  const [phase, setPhase] = useState<'idle' | 'sending' | 'resolving'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const output = run.output
  const busy = phase !== 'idle'
  const edited = output ? draft.trim() !== output.reply.trim() : false
  const canSend = Boolean(output) && draft.trim().length > 0 && !busy

  async function onSend() {
    if (!canSend) return
    setPhase('sending')
    setError(null)
    setNote(null)
    try {
      const res = await fetch(`/api/customers/${customerId}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          content: draft.trim(),
          runId: run.id,
          clientMsgId: sendId,
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        source?: string
        suggestionEdited?: boolean
      } | null
      if (!res.ok) {
        setError(`发送失败（HTTP ${res.status}）`)
        return
      }
      setSendId(randomId())
      setNote(
        `已发送 · 记录来源 ${data?.source ?? 'ai_suggested'}${data?.suggestionEdited ? ' · 内容有编辑' : ' · 原文未改'}`,
      )
      router.refresh()
    } catch (e) {
      setError(`发送失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPhase('idle')
    }
  }

  async function onResolveHuman() {
    setPhase('resolving')
    setError(null)
    setNote(null)
    try {
      const res = await fetch(`/api/customers/${customerId}/resolve-human`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      if (!res.ok) {
        setError(`解除人工失败（HTTP ${res.status}）`)
        return
      }
      setNote('已解除人工 · 已写入 humanResolvedAt')
      router.refresh()
    } catch (e) {
      setError(`解除人工失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPhase('idle')
    }
  }

  return (
    <section className="rounded border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">AI 建议</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            STATUS_STYLE[run.status] ?? 'bg-slate-100 text-slate-600'
          }`}
        >
          {run.status}
        </span>
      </div>

      {needHuman && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-red-700">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            已转人工（need_human 棘轮：AI 无权撤销）
          </div>
          {humanReason && <p className="mt-1 text-xs text-red-700/80">原因：{humanReason}</p>}
          <button
            type="button"
            onClick={onResolveHuman}
            disabled={busy}
            className="mt-2 rounded border border-red-300 bg-white px-3 py-1 text-xs text-red-700 disabled:opacity-50"
          >
            {phase === 'resolving' ? '处理中…' : '解除人工'}
          </button>
        </div>
      )}

      {output ? (
        <div className="mt-3 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <Field label="客户意图" value={output.customer_intent} />
            <div>
              <div className="text-xs text-slate-500">客户阶段</div>
              <div className="mt-1">
                <StageBadge stage={output.lead_stage} />
              </div>
            </div>
            <Field label="下一步动作" value={output.next_action} />
            <Field label="置信度" value={output.confidence.toFixed(2)} />
          </div>

          <div>
            <div className="text-xs text-slate-500">命中规则</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {run.rulesHit.length > 0 ? (
                run.rulesHit.map((r) => (
                  <span
                    key={r}
                    className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                  >
                    命中 {r}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-400">无</span>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">建议回复（可编辑）</span>
              {edited && <span className="text-xs text-amber-700">已修改</span>}
            </div>
            <textarea
              className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              rows={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={onSend}
                disabled={!canSend}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              >
                {phase === 'sending' ? '发送中…' : '发送'}
              </button>
              <button
                type="button"
                onClick={() => setDraft(output.reply)}
                disabled={busy || !edited}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 disabled:opacity-40"
              >
                还原 AI 原文
              </button>
            </div>
          </div>

          <details>
            <summary className="cursor-pointer text-xs text-slate-500">判断依据 reason</summary>
            <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{output.reason}</p>
          </details>

          {run.guardrailIssues.length > 0 && (
            <div className="rounded bg-amber-50 px-3 py-2">
              <div className="text-xs text-amber-800">护栏介入：{run.guardrailIssues.length} 项</div>
              <ul className="mt-1 list-disc pl-4 text-xs text-amber-900">
                {run.guardrailIssues.map((i) => (
                  <li key={i}>{ISSUE_LABEL[i] ?? i}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-red-600">
          本次判定没有拿到可用结果：{run.error ?? '未知原因'}
        </p>
      )}

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
      {note && <p className="mt-3 text-xs text-emerald-700">{note}</p>}

      <div className="mt-4 border-t border-slate-200 pt-2 text-xs text-slate-400">
        {run.model} · {run.latencyMs}ms · 第 {run.attempt} 次调用 · {formatDateTime(run.createdAt)}
      </div>
    </section>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1">{value}</div>
    </div>
  )
}
