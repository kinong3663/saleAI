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

//
// AI 与业务之间的裁决层：模型提出判断，这个文件决定判断能不能生效。
// 跑在 Zod 校验之后、落库之前。
//
// G1–G6 是实施文档 Part 1.4 定稿的六条；G7 是配置改造时补的第七条。
// 七条的分工：G3 与 G7 是**数据驱动**的（参数来自租户配置），其余五条是纯代码规则。
// 也就是说：护栏逻辑全租户共用，加新租户不用改这个文件。
//
export type GuardrailIssue =
  | 'terminal_stage_locked'
  | 'stage_regression_blocked'
  | 'price_rule_violated'
  | 'human_flag_action_mismatch'
  | 'low_confidence_escalation'
  | 'followup_advance_blocked'
  | 'human_trigger_matched'

export interface GuardrailContext {
  prevStage: LeadStage
  trigger: Trigger
  rules: TenantRule[]
  /** 客户说过的**全部**内容（供 G3 判断「是否已提供过证件」这类累计条件） */
  historyText: string
  /** 租户配置的转人工条件清单（G7 的白名单） */
  needHumanTriggers: string[]
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

  // ── G7 转人工条件（数据驱动：模型报条件，租户配置定白名单） ──
  //
  // 分工：模型负责语义 —— 客户说「让真人给我打电话」，它该认出这是配置里的「要求真人」；
  //       代码负责边界 —— 只能报清单里已有的条件，自己发明的一律作废。
  // 这样配置里可以继续写**条件描述**（读起来是业务语言），而不是退化成关键词表。
  //
  const reported = out.human_trigger.trim()
  if (reported !== '') {
    const allowed = ctx.needHumanTriggers.some((t) => t === reported)
    if (allowed) {
      if (!out.need_human) {
        out.need_human = true
        out.next_action = '转人工'
        issues.push('human_trigger_matched')
      }
      // 无论模型自己有没有置 need_human，都把命中的条件写进 reason，让审计看得见
      if (!out.reason.includes(reported)) {
        out.reason = `${out.reason}｜命中转人工条件：${reported}`
      }
    } else {
      // 清单外的条件：作废（模型不能自己发明转人工的理由），清空这个字段避免污染审计
      out.human_trigger = ''
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

//
// 重生成时的追加约束。直接点名违反了哪条规则 —— 比「你违反了规则」这种空话有效得多。
//
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
    '## 追加约束（触发于护栏）',
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
