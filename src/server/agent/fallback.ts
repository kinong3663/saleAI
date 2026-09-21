import { CUSTOMER_INTENTS, type CustomerIntent, type LeadStage } from '@/lib/constants'
import type { AgentOutputLoose } from './schema'

/**
 * 降级输出（实施文档 S7 的设计重点）。
 *
 * AI 不可用时，销售看到的应该是一张「已转人工」的卡片，而不是红屏。
 * 三条硬性语义：
 *   ① 状态不前进 —— leadStage / intent 保持原值（由 state.service 的 fallback 开关保证）
 *   ② need_human = true，next_action = 转人工
 *   ③ AgentRun.status = FALLBACK，error 记录原因
 */

/** 降级话术：不承诺、不编造，只说明会有人来接手 */
export const FALLBACK_REPLY = '不好意思，这条我需要请同事帮你确认一下，稍后回复你～'

export function buildFallbackOutput(input: {
  prevStage: LeadStage
  prevIntent: string | null
  error: string
}): AgentOutputLoose {
  return {
    customer_intent: asIntent(input.prevIntent),
    lead_stage: input.prevStage,
    next_action: '转人工',
    reply: FALLBACK_REPLY,
    reason: `AI 暂不可用，已转人工（${input.error}）`,
    need_human: true,
    rules_hit: [],
    confidence: 0,
  }
}

function asIntent(intent: string | null): CustomerIntent {
  return CUSTOMER_INTENTS.includes(intent as CustomerIntent)
    ? (intent as CustomerIntent)
    : '其他'
}
