import {
  INTEREST_INTENTS,
  LOW_CONFIDENCE_THRESHOLD,
  STAGE_RANK,
  isTerminalStage,
  type LeadStage,
  type Trigger,
} from '@/lib/constants'
import type { TenantProduct, TenantRule } from '@/lib/types'
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
  | 'human_only_price_leaked'
  // P5：不认识的强制种类不静默跳过 —— 有人直连改库时，只有运行时可观测能兜住
  | `unknown_enforcement_kind:${string}`
  // G8：回复里出现了产品表里没有的价格
  | `fabricated_price:${string}`

export interface GuardrailContext {
  prevStage: LeadStage
  trigger: Trigger
  rules: TenantRule[]
  /** 客户说过的**全部**内容（供 G3 判断「是否已提供过证件」这类累计条件） */
  historyText: string
  /** 租户配置的转人工条件清单（G7 的白名单） */
  needHumanTriggers: string[]
  /** 租户配置的产品表（G3 的对象维度 + G8 的已知价格集合） */
  products: TenantProduct[]
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

  const knownPrices = new Set(
    ctx.products
      .filter((p) => p.enabled !== false)
      .map((p) => p.price)
      .filter((n): n is number => typeof n === 'number'),
  )
  const saidPrices = extractPrices(out.reply)

  // ── G3 报价约束（两个维度） ──
  // 时间维度：什么时候允许报价 —— 由规则决定
  for (const rule of ctx.rules) {
    const e = rule.enforcement
    if (!e) continue
    if (e.kind !== 'FORBID_PRICE_UNTIL') {
      // P5：不静默跳过。写进 guardrailIssues，等于给未来埋一个搜索锚点
      issues.push(`unknown_enforcement_kind:${rule.id}`)
      continue
    }
    if (isConditionMet(e.condition, out, ctx)) continue // 条件已满足 → 允许报价
    if (saidPrices.length > 0) {
      issues.push('price_rule_violated')
      out.rules_hit = [...new Set([...out.rules_hit, rule.id])]
      needsRegen = true
    }
  }

  // 对象维度：哪些产品允许自动报价 —— 由产品决定
  // 引流品随口报是获客，大单报价会毁掉谈判空间，所以 HUMAN_ONLY 的产品即使规则允许也不许自动说。
  const humanOnlyPrices = new Set(
    ctx.products
      .filter((p) => p.enabled !== false && p.quotePolicy === 'HUMAN_ONLY')
      .map((p) => p.price)
      .filter((n): n is number => typeof n === 'number'),
  )
  if (saidPrices.some((n) => humanOnlyPrices.has(n))) {
    issues.push('human_only_price_leaked')
    out.need_human = true
    out.next_action = '转人工'
    needsRegen = true
  }

  // ── G8 禁止编造价格 ──
  // 回复里的价格必须命中产品表的已知价格集合（用**数值**比较：'1980'.includes('198') 是 true，子串判断会放行假价格）
  const fabricated = saidPrices.filter((n) => !knownPrices.has(n))
  if (fabricated.length > 0) {
    issues.push(`fabricated_price:${fabricated.join(',')}`)
    needsRegen = true
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

//
// 从回复里抽出具体价格（元为基准）。
// 必须是**数值**比较，不能用子串：'1980'.includes('198') 是 true，
// 会把"1980 元"误认成合法价格 198。
// 刻意不匹配「4 岁」「3 天」这类非价格数字。
//
function extractPrices(text: string): number[] {
  const out: number[] = []
  const pattern = /(\d[\d,]*(?:\.\d+)?)\s*(万|块钱|元|块|K|k)/g
  for (const m of text.matchAll(pattern)) {
    const value = Number(m[1].replace(/,/g, ''))
    if (!Number.isFinite(value)) continue
    const unit = m[2]
    out.push(unit === '万' ? value * 10_000 : unit === 'K' || unit === 'k' ? value * 1000 : value)
  }
  return out
}

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
