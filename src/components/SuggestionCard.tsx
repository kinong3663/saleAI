import type { AgentRunDTO } from '@/lib/types'
import { formatDateTime } from '@/lib/datetime'
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

/** AI 建议卡片：意图 / 阶段 / 动作 / 命中规则（高亮）/ 建议回复 / 判断依据 */
export function SuggestionCard({ run }: { run: AgentRunDTO }) {
  const output = run.output

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
            <div className="text-xs text-slate-500">建议回复</div>
            <div className="mt-1 whitespace-pre-wrap rounded bg-slate-50 px-3 py-2">
              {output.reply}
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

          {output.need_human && (
            <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-700">
              建议人工介入（need_human = true）
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-red-600">
          本次判定没有拿到可用结果：{run.error ?? '未知原因'}
        </p>
      )}

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
