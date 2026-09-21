import {
  INTEREST_INTENTS,
  LOW_CONFIDENCE_THRESHOLD,
  STAGE_RANK,
  isTerminalStage,
  type LeadStage,
  type Trigger,
} from '@/lib/constants'
import type { TenantRule } from '@/lib/types'
import type { AgentOutputLoose } from './schema'

/**
 * AI 与业务之间的裁决层：模型提出判断，这个文件决定判断能不能生效。
 * 跑在 Zod 校验之后、落库之前。
 */
export type GuardrailIssue =
  | 'terminal_stage_locked'
  | 'stage_regression_blocked'
  | 'price_rule_violated'
  | 'human_flag_action_mismatch'
  | 'low_confidence_escalation'
  | 'followup_advance_blocked'

export interface GuardrailContext {
  prevStage: LeadStage
  trigger: Trigger
  rules: TenantRule[]
  /** 客户说过的全部内容（用于条件判定） */
  historyText: string
}

export interface GuardrailResult {
  output: AgentOutputLoose
  issues: GuardrailIssue[]
  /** true 表示应带约束重生成一次 */
  needsRegen: boolean
}

export function applyGuardrails(out: AgentOutputLoose, ctx: GuardrailContext): GuardrailResult {
  const issues: GuardrailIssue[] = []
  let needsRegen = false
  const prev = ctx.prevStage
  const cur = out.lead_stage

  // ── G1 终态锁：WON / LOST 不许被 AI 改回去 ──
  if (isTerminalStage(prev) && cur !== prev) {
    out.lead_stage = prev
    issues.push('terminal_stage_locked')
  }
  // ── G2 阶段单调：不允许回退 ──
  else if (STAGE_RANK[cur] < STAGE_RANK[prev]) {
    out.lead_stage = prev
    issues.push('stage_regression_blocked')
  }
  // ── G6 跟进不推进阶段（决策 Q13） ──
  else if (ctx.trigger === 'FOLLOW_UP' && STAGE_RANK[cur] > STAGE_RANK[prev]) {
    out.lead_stage = prev
    issues.push('followup_advance_blocked')
  }

  // ── G3 报价规则（数据驱动，不是硬编码租户名） ──
  for (const rule of ctx.rules) {
    const e = rule.enforcement
    if (e?.kind !== 'FORBID_PRICE_UNTIL') continue
    if (isConditionMet(e.condition, out, ctx)) continue // 条件已满足 → 允许报价
    if (CONCRETE_PRICE.test(out.reply)) {
      issues.push('price_rule_violated')
      out.rules_hit = [...new Set([...out.rules_hit, rule.id])]
      needsRegen = true
    }
  }

  // ── G4 转人工一致性 ──
  if (out.need_human) {
    if (out.next_action !== '转人工') {
      out.next_action = '转人工'
      issues.push('human_flag_action_mismatch')
    }
    if (!out.reply.trim()) {
      out.reply = '这个问题我需要请同事帮你确认一下，稍等我回复你～'
    }
  }

  // ── G5 低置信度 + 高风险动作 → 升级为人工 ──
  if (
    out.confidence < LOW_CONFIDENCE_THRESHOLD &&
    (out.lead_stage === 'HIGH_INTENT' || out.lead_stage === 'WON') &&
    !out.need_human
  ) {
    out.need_human = true
    out.next_action = '转人工'
    issues.push('low_confidence_escalation')
  }

  return { output: out, issues, needsRegen }
}

/**
 * 重生成时的追加约束。直接点名违反了哪条规则 —— 比「你违反了规则」这种空话有效得多。
 */
export function buildCorrectionSuffix(
  rules: TenantRule[],
  issues: GuardrailIssue[],
): string {
  const violated = rules.filter(
    (r) => r.enforcement?.kind === 'FORBID_PRICE_UNTIL' && issues.includes('price_rule_violated'),
  )
  const named = violated.map((r) => `${r.id}（${r.text}）`).join('、') || '报价规则'

  return [
    '',
    `## 追加约束（触发于护栏）`,
    `你上一次的输出违反了规则 ${named}。`,
    '请重新输出 JSON，reply 中不要出现任何具体价格（不要写数字 + 元/块/万）。',
    '改为说明为什么需要先了解更多信息，并给出一个具体的下一步。',
  ].join('\n')
}

// ───────── 内部 ─────────

/** 具体价格：数字 + 货币单位。刻意不匹配「4 岁」「3 天」这类非价格数字。 */
const CONCRETE_PRICE = /(\d+(?:\.\d+)?)\s*(?:元|块钱|块|万|K|k)/

function isConditionMet(
  condition: string,
  out: AgentOutputLoose,
  ctx: GuardrailContext,
): boolean {
  switch (condition) {
    case 'INTEREST_EXPRESSED':
      return INTEREST_INTENTS.includes(out.customer_intent)
    case 'DOCUMENT_CONFIRMED':
      // 启发式：历史里出现过证件相关词，或阶段已达 HIGH_INTENT
      return (
        /行驶证|车牌|证件|已拍|照片|发给你/.test(ctx.historyText) ||
        STAGE_RANK[out.lead_stage] >= STAGE_RANK.HIGH_INTENT
      )
    default:
      return false
  }
}
