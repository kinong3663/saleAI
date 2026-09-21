/**
 * 前后端共享类型（DTO）。
 * 约定：时间统一用 ISO 字符串 —— 服务端直接拿 Date 时是 Date 对象，
 * 经 JSON 出去又变成字符串，两种形状漂移是这类项目最常见的低级 bug。
 */

// 只借类型，不引入运行时依赖：前端组件 import 这个文件不会把 agent/ 打进 bundle
import type { AgentOutput } from '@/server/agent/schema'

/** 与数据库的 MessageRole 枚举保持一致（枚举的唯一定义在 src/lib/constants.ts） */
export type MessageRoleValue = 'CUSTOMER' | 'SALES' | 'SYSTEM'

export interface TenantDTO {
  id: string
  slug: string
  name: string
}

// ─────────── 租户配置（tenants.config 的结构，决策 Q3） ───────────

export type RuleType = 'PROHIBIT' | 'REQUIRE' | 'PREFER'

export interface TenantRuleEnforcement {
  kind: string
  condition: string
}

export interface TenantRule {
  id: string
  type: RuleType
  text: string
  enforcement?: TenantRuleEnforcement
}

export interface TenantConfig {
  rules: TenantRule[]
  stageDefs: Record<string, string>
  needHumanTriggers: string[]
  replyTone?: string
  priceFallbackReply: string
  followUpAfterHours: number
  maxFollowUps: number
  products: { name: string; price?: number }[]
}

/** 给 agent pipeline 用的租户视图（含 config） */
export interface TenantForAgent {
  id: string
  name: string
  salesGoal: string
  tone: string | null
  config: TenantConfig
}

// ─────────── 客户与消息 ───────────

export interface CustomerStateDTO {
  leadStage: string
  intent: string | null
  needHuman: boolean
  humanReason: string | null
  lastActivityAt: string | null
}

export interface CustomerSummary {
  id: string
  tenantId: string
  name: string
  channel: string
  tags: string
  createdAt: string
  updatedAt: string
  /** 客户状态可能还不存在（状态由 S5 的闭环写入），所以这里是可空的 */
  state: CustomerStateDTO | null
}

export interface MessageDTO {
  id: string
  tenantId: string
  customerId: string
  role: MessageRoleValue
  content: string
  source: string
  clientMsgId: string | null
  createdAt: string
}

export interface CustomerDetail extends CustomerSummary {
  /** 时间正序（最旧 → 最新），和聊天记录的阅读顺序一致 */
  messages: MessageDTO[]
}

// ─────────── AI 判定 ───────────

export type AgentRunStatus = 'SUCCESS' | 'REPAIRED' | 'FALLBACK' | 'FAILED'

export interface AgentRunDTO {
  id: string
  status: string
  model: string
  latencyMs: number
  attempt: number
  triggerMessageId: string | null
  output: AgentOutput | null
  rawOutput: string | null
  rulesHit: string[]
  guardrailIssues: string[]
  error: string | null
  createdAt: string
}
