/**
 * 所有枚举和魔法数字的唯一来源（前后端共享）。
 * 依据：docs/实施文档.md Part 1.1
 */

// ─── 消息角色 ───
export const MESSAGE_ROLES = ['CUSTOMER', 'SALES', 'SYSTEM'] as const
export type MessageRole = (typeof MESSAGE_ROLES)[number]

// ─── 客户阶段 ───
export const LEAD_STAGES = [
  'NEW',
  'DISCOVERY',
  'INTERESTED',
  'HIGH_INTENT',
  'WON',
  'LOST',
] as const
export type LeadStage = (typeof LEAD_STAGES)[number]

/**
 * 阶段推进的序号，只用于判断「是否回退」。
 * WON / LOST 给 4 是因为：进入终态是合法迁移，而「从终态出去」由终态锁单独拦。
 */
export const STAGE_RANK: Record<LeadStage, number> = {
  NEW: 0,
  DISCOVERY: 1,
  INTERESTED: 2,
  HIGH_INTENT: 3,
  WON: 4,
  LOST: 4,
}

export const TERMINAL_STAGES: readonly LeadStage[] = ['WON', 'LOST']
export const isTerminalStage = (s: LeadStage) => TERMINAL_STAGES.includes(s)

// ─── 客户意图 ───
export const CUSTOMER_INTENTS = [
  '了解产品',
  '询价',
  '预约',
  '犹豫',
  '投诉',
  '购买',
  '其他',
] as const
export type CustomerIntent = (typeof CUSTOMER_INTENTS)[number]

/** 视为「已表达明确兴趣」的意图 —— 用于租户规则的条件判定 */
export const INTEREST_INTENTS: readonly CustomerIntent[] = ['询价', '预约', '购买']

// ─── 销售动作 ───
export const NEXT_ACTIONS = [
  '继续探需',
  '回答问题',
  '推进体验',
  '确认需求',
  '索取资料',
  '转人工',
  '暂不处理',
] as const
export type NextAction = (typeof NEXT_ACTIONS)[number]

// ─── 触发来源（决策 Q12） ───
export const TRIGGERS = ['CUSTOMER_MESSAGE', 'FOLLOW_UP'] as const
export type Trigger = (typeof TRIGGERS)[number]

// ─── 运行参数 ───
export const HISTORY_LIMIT = 20 // 决策 Q9：固定 20 条，生产应改为按 token 截断
export const LLM_TIMEOUT_MS = 20_000
export const LLM_RETRIES = 1
export const LOW_CONFIDENCE_THRESHOLD = 0.4 // 低于此值 + 高风险动作 → 转人工
export const FOLLOWUP_SCAN_INTERVAL_MS = 60_000 // 决策 Q6

// ─── 规则强制类型（决策 Q3：规则可配置，但强制种类有限） ───
export const ENFORCEMENT_KINDS = ['FORBID_PRICE_UNTIL'] as const
export const ENFORCEMENT_CONDITIONS = [
  'INTEREST_EXPRESSED', // 客户已表达明确兴趣
  'DOCUMENT_CONFIRMED', // 客户已确认提供资料（行驶证等）
] as const
