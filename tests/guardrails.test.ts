import { describe, expect, it } from 'vitest'
import type { TenantRule } from '@/lib/types'
import {
  applyGuardrails,
  buildCorrectionSuffix,
  type GuardrailContext,
} from '@/server/agent/guardrails'
import type { AgentOutputLoose } from '@/server/agent/schema'

/**
 * G1–G7 七条护栏。
 * 这是全系统最值得测的部分：它是「模型说的话算不算数」的唯一裁决点。
 * 全部是纯函数，不需要数据库、不需要模型 —— 所以快、稳、不花钱。
 *
 * 七条里 G3 与 G7 是**数据驱动**的（参数来自租户配置），其余五条是纯代码规则。
 */

/** 造一个「模型刚输出的对象」。每个用例都用全新对象：护栏是**就地改写**的 */
function modelOutput(partial: Partial<AgentOutputLoose> = {}): AgentOutputLoose {
  return {
    customer_intent: '了解产品',
    lead_stage: 'DISCOVERY',
    next_action: '继续探需',
    reply: '你好呀，需要了解点什么？',
    reason: '测试用的判断依据',
    need_human: false,
    human_trigger: '',
    rules_hit: [],
    confidence: 0.9,
    ...partial,
  }
}

function ctx(partial: Partial<GuardrailContext> = {}): GuardrailContext {
  return {
    prevStage: 'DISCOVERY',
    trigger: 'CUSTOMER_MESSAGE',
    rules: [],
    historyText: '',
    needHumanTriggers: [],
    ...partial,
  }
}

const PRICE_RULE_INTEREST: TenantRule = {
  id: 'R1',
  type: 'PROHIBIT',
  text: '客户未表达明确兴趣前，不主动报价',
  enforcement: { kind: 'FORBID_PRICE_UNTIL', condition: 'INTEREST_EXPRESSED' },
}

const PRICE_RULE_DOCUMENT: TenantRule = {
  id: 'R2',
  type: 'PROHIBIT',
  text: '未取得行驶证信息前，不给出具体报价',
  enforcement: { kind: 'FORBID_PRICE_UNTIL', condition: 'DOCUMENT_CONFIRMED' },
}

/** 与 prisma/seed.ts 一致的两个租户的转人工条件清单 */
const SWIM_TRIGGERS = ['投诉', '要求真人', '涉及退款', 'AI 无法确认答案']
const MACHINERY_TRIGGERS = ['投诉', '要求真人', '涉及退款', '纠纷']

describe('G1 终态锁', () => {
  it('WON 被模型改成 INTERESTED → 输出仍是 WON，并记录 terminal_stage_locked', () => {
    const result = applyGuardrails(
      modelOutput({ lead_stage: 'INTERESTED' }),
      ctx({ prevStage: 'WON' }),
    )
    expect(result.output.lead_stage).toBe('WON')
    expect(result.issues).toContain('terminal_stage_locked')
  })

  it('LOST 也一样锁住', () => {
    const result = applyGuardrails(modelOutput({ lead_stage: 'WON' }), ctx({ prevStage: 'LOST' }))
    expect(result.output.lead_stage).toBe('LOST')
    expect(result.issues).toContain('terminal_stage_locked')
  })

  it('阶段没变时不算问题', () => {
    const result = applyGuardrails(modelOutput({ lead_stage: 'WON' }), ctx({ prevStage: 'WON' }))
    expect(result.issues).toEqual([])
  })
})

describe('G2 阶段单调（不允许回退）', () => {
  it('INTERESTED 被降成 DISCOVERY → 压回 INTERESTED', () => {
    const result = applyGuardrails(
      modelOutput({ lead_stage: 'DISCOVERY' }),
      ctx({ prevStage: 'INTERESTED' }),
    )
    expect(result.output.lead_stage).toBe('INTERESTED')
    expect(result.issues).toContain('stage_regression_blocked')
  })

  it('正常前进不受影响', () => {
    const result = applyGuardrails(
      modelOutput({ lead_stage: 'HIGH_INTENT' }),
      ctx({ prevStage: 'INTERESTED' }),
    )
    expect(result.output.lead_stage).toBe('HIGH_INTENT')
    expect(result.issues).toEqual([])
  })
})

describe('G3 报价护栏（数据驱动，不是硬编码租户名）', () => {
  it('条件满足（客户已表达兴趣）→ 允许报价', () => {
    const result = applyGuardrails(
      modelOutput({ customer_intent: '询价', reply: '体验课 198 元，本周还有位置' }),
      ctx({ rules: [PRICE_RULE_INTEREST] }),
    )
    expect(result.issues).not.toContain('price_rule_violated')
    expect(result.needsRegen).toBe(false)
  })

  it('条件不满足（还没表达兴趣）→ 拦下，并回填命中规则', () => {
    const result = applyGuardrails(
      modelOutput({ customer_intent: '了解产品', reply: '体验课 198 元' }),
      ctx({ rules: [PRICE_RULE_INTEREST] }),
    )
    expect(result.issues).toContain('price_rule_violated')
    expect(result.needsRegen).toBe(true)
    expect(result.output.rules_hit).toContain('R1')
  })

  it('同一个 kind、不同 condition：DOCUMENT_CONFIRMED 未满足 → 拦下（机械之家）', () => {
    const result = applyGuardrails(
      modelOutput({ reply: '修一次大概 800 元' }),
      ctx({ rules: [PRICE_RULE_DOCUMENT], historyText: '我有一台挖掘机' }),
    )
    expect(result.issues).toContain('price_rule_violated')
  })

  it('DOCUMENT_CONFIRMED 已满足（历史里出现过证件）→ 放行', () => {
    const result = applyGuardrails(
      modelOutput({ reply: '修一次大概 800 元' }),
      ctx({ rules: [PRICE_RULE_DOCUMENT], historyText: '我把行驶证拍给你了' }),
    )
    expect(result.issues).not.toContain('price_rule_violated')
  })

  it('数字不等于价格：「4 岁」「3 天」不该被误判', () => {
    const result = applyGuardrails(
      modelOutput({ customer_intent: '了解产品', reply: '适合 4 岁的孩子，一周 3 天都可以' }),
      ctx({ rules: [PRICE_RULE_INTEREST] }),
    )
    expect(result.issues).not.toContain('price_rule_violated')
  })

  it('重生成提示会把违反的规则编号点名出来', () => {
    const suffix = buildCorrectionSuffix([PRICE_RULE_INTEREST], ['price_rule_violated'])
    expect(suffix).toContain('R1')
    expect(suffix).toContain('不要')
  })
})

describe('G4 转人工一致性', () => {
  it('need_human=true 但动作不是转人工 → 强制改成转人工', () => {
    const result = applyGuardrails(
      modelOutput({ need_human: true, next_action: '回答问题' }),
      ctx(),
    )
    expect(result.output.next_action).toBe('转人工')
    expect(result.issues).toContain('human_flag_action_mismatch')
  })

  it('need_human=true 且 reply 为空 → 补一句兜底话术', () => {
    const result = applyGuardrails(modelOutput({ need_human: true, reply: '   ' }), ctx())
    expect(result.output.reply.trim().length).toBeGreaterThan(0)
  })
})

describe('G5 低置信度 + 高风险动作', () => {
  it('置信度 0.2 且阶段是 HIGH_INTENT → 升级为人工', () => {
    const result = applyGuardrails(
      modelOutput({ lead_stage: 'HIGH_INTENT', confidence: 0.2, need_human: false }),
      ctx({ prevStage: 'INTERESTED' }),
    )
    expect(result.output.need_human).toBe(true)
    expect(result.output.next_action).toBe('转人工')
    expect(result.issues).toContain('low_confidence_escalation')
  })

  it('低置信度但阶段不高（DISCOVERY）→ 不升级', () => {
    const result = applyGuardrails(modelOutput({ confidence: 0.2 }), ctx())
    expect(result.output.need_human).toBe(false)
    expect(result.issues).not.toContain('low_confidence_escalation')
  })
})

describe('G6 跟进不推进阶段', () => {
  it('trigger=FOLLOW_UP 且想往前推 → 压回上轮', () => {
    const result = applyGuardrails(
      modelOutput({ lead_stage: 'HIGH_INTENT' }),
      ctx({ prevStage: 'INTERESTED', trigger: 'FOLLOW_UP' }),
    )
    expect(result.output.lead_stage).toBe('INTERESTED')
    expect(result.issues).toContain('followup_advance_blocked')
  })

  it('跟进里想往回退，仍然走 G2（护栏有先后顺序）', () => {
    const result = applyGuardrails(
      modelOutput({ lead_stage: 'DISCOVERY' }),
      ctx({ prevStage: 'INTERESTED', trigger: 'FOLLOW_UP' }),
    )
    expect(result.issues).toContain('stage_regression_blocked')
    expect(result.issues).not.toContain('followup_advance_blocked')
  })
})

describe('G7 转人工条件（数据驱动：模型报条件，租户配置定白名单）', () => {
  it('模型报的条件在清单里 → 强制转人工（哪怕它自己说 need_human=false）', () => {
    const result = applyGuardrails(
      modelOutput({ need_human: false, human_trigger: '投诉' }),
      ctx({ needHumanTriggers: SWIM_TRIGGERS }),
    )
    expect(result.output.need_human).toBe(true)
    expect(result.output.next_action).toBe('转人工')
    expect(result.issues).toContain('human_trigger_matched')
    expect(result.output.reason).toContain('投诉')
  })

  it('条件描述同样可用：模型把「让真人给我打电话」归到「要求真人」→ 校验通过', () => {
    // 这正是「条件描述」方案的意义：语义识别是模型的活，代码只校验它在不在清单里
    const result = applyGuardrails(
      modelOutput({ human_trigger: '要求真人' }),
      ctx({ needHumanTriggers: SWIM_TRIGGERS }),
    )
    expect(result.output.need_human).toBe(true)
    expect(result.issues).toContain('human_trigger_matched')
  })

  it('模型自己发明清单外的条件 → 作废：不升级，并把字段清空', () => {
    const result = applyGuardrails(
      modelOutput({ human_trigger: '客户想砍价' }),
      ctx({ needHumanTriggers: SWIM_TRIGGERS }),
    )
    expect(result.output.need_human).toBe(false)
    expect(result.issues).not.toContain('human_trigger_matched')
    expect(result.output.human_trigger).toBe('')
  })

  it('租户没配触发词 → 模型报了也不升级', () => {
    const result = applyGuardrails(
      modelOutput({ human_trigger: '投诉' }),
      ctx({ needHumanTriggers: [] }),
    )
    expect(result.output.need_human).toBe(false)
    expect(result.output.human_trigger).toBe('')
  })

  it('没命中（空字符串）→ 什么都不做', () => {
    const result = applyGuardrails(
      modelOutput({ human_trigger: '' }),
      ctx({ needHumanTriggers: SWIM_TRIGGERS }),
    )
    expect(result.issues).toEqual([])
  })

  it('模型自己已经置了 need_human → 不重复记问题，但条件仍写进 reason', () => {
    const result = applyGuardrails(
      modelOutput({ need_human: true, next_action: '转人工', human_trigger: '投诉' }),
      ctx({ needHumanTriggers: SWIM_TRIGGERS }),
    )
    expect(result.issues).toEqual([])
    expect(result.output.reason).toContain('投诉')
  })

  it('白名单是按租户配置的：同一条条件在另一个租户不成立', () => {
    const result = applyGuardrails(
      modelOutput({ human_trigger: 'AI 无法确认答案' }),
      ctx({ needHumanTriggers: MACHINERY_TRIGGERS }),
    )
    expect(result.output.need_human).toBe(false)
    expect(result.output.human_trigger).toBe('')
  })
})
