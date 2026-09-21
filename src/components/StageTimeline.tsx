import type { AgentRunDTO } from '@/lib/types'
import { formatDateTime } from '@/lib/datetime'
import { StageBadge } from './StageBadge'

const ISSUE_LABEL: Record<string, string> = {
  terminal_stage_locked: '终态锁',
  stage_regression_blocked: '禁止回退',
  price_rule_violated: '报价规则',
  human_flag_action_mismatch: '转人工一致性',
  low_confidence_escalation: '低置信度升级',
  followup_advance_blocked: '跟进不推进',
}

/**
 * 状态时间线。
 * 没有单独的状态历史表 —— AgentRun 就是变更记录：每次判定都留下「那一轮判成什么阶段」。
 */
export function StageTimeline({ runs }: { runs: AgentRunDTO[] }) {
  if (runs.length === 0) {
    return <p className="text-xs text-slate-400">还没有判定记录</p>
  }

  return (
    <ol className="space-y-2">
      {runs.map((run) => (
        <li key={run.id} className="flex gap-2 text-xs">
          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <StageBadge stage={run.output?.lead_stage ?? null} />
              <span className="text-[10px] text-slate-400">{run.status}</span>
            </div>
            <div className="mt-0.5 text-slate-400">
              {formatDateTime(run.createdAt)}
              {run.rulesHit.length > 0 ? ` · 命中 ${run.rulesHit.join('/')}` : ''}
            </div>
            {run.guardrailIssues.length > 0 && (
              <div className="mt-0.5 text-amber-700">
                护栏：{run.guardrailIssues.map((i) => ISSUE_LABEL[i] ?? i).join('、')}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
