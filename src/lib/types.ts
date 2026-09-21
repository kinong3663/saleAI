/**
 * 前后端共享类型（DTO）。
 * 约定：时间统一用 ISO 字符串 —— 服务端直接拿 Date 时是 Date 对象，
 * 经 JSON 出去又变成字符串，两种形状漂移是这类项目最常见的低级 bug。
 */

/** 与数据库的 MessageRole 枚举保持一致（枚举的唯一定义在 src/lib/constants.ts，S3 落地） */
export type MessageRoleValue = 'CUSTOMER' | 'SALES' | 'SYSTEM'

export interface TenantDTO {
  id: string
  slug: string
  name: string
}

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
