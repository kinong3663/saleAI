import { Prisma } from '@prisma/client'
import { prisma } from '@/server/db'
import type { CustomerStateDTO } from '@/lib/types'
import type { AgentOutputLoose } from '@/server/agent/schema'
import { isTerminalStage, type LeadStage, type Trigger } from '@/lib/constants'

/**
 * CustomerState 的唯一写入方。
 *
 * 四条不能违反的语义：
 * ① needHuman 是**棘轮**：prev.needHuman || 本次判断，AI 无权撤销（决策 Q4）
 * ② 状态迁移（leadStage / intent）只由客户的新输入驱动（决策 Q13）
 * ③ 降级（fallback）时**状态不前进**：只动 needHuman 与时间戳（实施文档 S7）
 * ④ 每次状态变更 version +1
 */

/** 允许传入事务客户端，让「写状态」和同一次判定产生的 AgentRun 落在同一个事务里 */
export type StateDb = Pick<Prisma.TransactionClient, 'customerState'>

export interface AnalysisStateInput {
  trigger: Trigger
  /** 护栏之后的输出（不是模型原始输出） */
  output: AgentOutputLoose
  /** 触发这次判定的时间，用于 lastCustomerMessageAt / lastActivityAt */
  at: Date
  /** true = 这次是 AI 降级路径：不推进阶段与意图 */
  fallback?: boolean
}

export async function applyAnalysisToState(
  tenantId: string,
  customerId: string,
  input: AnalysisStateInput,
  db: StateDb = prisma,
): Promise<void> {
  const current = await db.customerState.findUnique({ where: { customerId } })

  // 触发源是不是「客户发来新消息」：决定要不要更新客户侧的时间戳
  const isCustomerMessage = input.trigger === 'CUSTOMER_MESSAGE'
  // 决策 Q13 + S7：只有客户新消息能推进阶段/意图，且降级时不推进
  const canAdvance = isCustomerMessage && !input.fallback

  const leadStage = canAdvance
    ? input.output.lead_stage
    : (current?.leadStage ?? input.output.lead_stage)
  const intent = canAdvance ? input.output.customer_intent : (current?.intent ?? null)

  // 「已购买多少次」= **进入** WON 的次数，而不是每次判定都算一次。
  // 客户成交后再来问（复购），阶段会重新流动（G1 已放开），下一次再进 WON 就是第 2 次成交。
  // 局限：如果模型在连着两条消息里 WON → 别的阶段 → WON 来回跳，可能把一次成交算成两次；
  // 要彻底解决得引入订单/商机表（决策：24H 内不做）。
  const countedPurchase = canAdvance && leadStage === 'WON' && current?.leadStage !== 'WON'

  // 棘轮：已经在人工手里，就不会被一次「AI 觉得不需要」翻回去
  const needHuman = (current?.needHuman ?? false) || input.output.need_human

  const lastActivityAt = maxDate(current?.lastActivityAt ?? null, input.at)
  const lastCustomerMessageAt = isCustomerMessage
    ? maxDate(current?.lastCustomerMessageAt ?? null, input.at)
    : (current?.lastCustomerMessageAt ?? null)

  const humanReason = needHuman
    ? (current?.humanReason ?? input.output.reason)
    : (current?.humanReason ?? null)

  await db.customerState.upsert({
    where: { customerId },
    create: {
      customerId,
      tenantId,
      leadStage,
      intent,
      needHuman,
      humanReason,
      lastCustomerMessageAt,
      lastSalesMessageAt: null,
      lastActivityAt,
      lastAnalysisAt: input.at,
      purchaseCount: countedPurchase ? 1 : 0,
      version: 1,
    },
    update: {
      leadStage,
      intent,
      needHuman,
      humanReason,
      lastCustomerMessageAt,
      lastActivityAt,
      lastAnalysisAt: input.at,
      // 只有「这一轮真的成交了」才 +1（重复判定为 WON 不会重复计数）
      ...(countedPurchase ? { purchaseCount: { increment: 1 } } : {}),
      version: { increment: 1 },
    },
  })
}

/**
 * 销售发出回复后调用（与写消息在同一个事务里）。
 * 跟进扫描要靠 lastSalesMessageAt > lastCustomerMessageAt 判断「客户没回我」，
 * 所以这个时间戳不能漏。
 */
export async function markSalesReplySent(
  tenantId: string,
  customerId: string,
  at: Date,
  db: StateDb = prisma,
): Promise<void> {
  const current = await db.customerState.findUnique({ where: { customerId } })
  const lastActivityAt = maxDate(current?.lastActivityAt ?? null, at)

  if (!current) {
    await db.customerState.create({
      data: {
        customerId,
        tenantId,
        lastSalesMessageAt: at,
        lastActivityAt,
        version: 1,
      },
    })
    return
  }

  await db.customerState.update({
    where: { customerId },
    data: {
      lastSalesMessageAt: maxDate(current.lastSalesMessageAt, at),
      lastActivityAt,
      version: { increment: 1 },
    },
  })
}

/**
 * 解除人工 —— 棘轮的必要出口（决策 Q4）。
 * 必须写 humanResolvedAt，否则「谁在什么时候把这单从人工手里拿回来」就查不到了。
 */
export async function resolveHuman(
  tenantId: string,
  customerId: string,
): Promise<CustomerStateDTO | null> {
  const current = await prisma.customerState.findFirst({ where: { customerId, tenantId } })
  if (!current) return null

  const updated = await prisma.customerState.update({
    where: { customerId },
    data: {
      needHuman: false,
      humanResolvedAt: new Date(),
      version: { increment: 1 },
    },
  })
  return toDTO(updated)
}

/** 重新激活之后回到哪个阶段（见下面 reopenTerminalState 的注释） */
export const REOPEN_STAGE: LeadStage = 'DISCOVERY'

export type ReopenResult =
  | { ok: true; state: CustomerStateDTO; from: string }
  | { ok: false; reason: 'not_found' | 'not_terminal' }

/**
 * 重新激活 —— 终态锁（G1）的人工出口。
 *
 * 为什么保留它：G1 已经放开（终态客户发新消息时阶段会自动重新流动），所以这个按钮不再是唯一出路，
 * 但它仍然是**人工主动**放回漏斗的那条路 —— 客户没发消息、或 AI 判定失败/说不清时，销售可以直接把线索捡回来。
 * 它做的事比 AI 自动流动更重：除了改阶段，还会清零跟进次数（让重开的线索重新拿到跟进预算）。
 *
 * 与针轮（needHuman）完全对称：针轮有 resolveHuman 出口，终态锁有 reopen 出口。
 * 但两者**互不代劳** —— 重新激活不会顺手解除人工，那是另一个决定，各留各的痕。
 *
 * 为什么回 DISCOVERY 而不是 NEW：NEW 的租户语义是「首次接触，尚未表达需求」，对回来的老客户不成立；
 * DISCOVERY「正在了解，需求不明确」才是准确的起点。（阶段语义见 prisma/seed.ts 的 stageDefs）
 *
 * 为什么顺手清 followUpCount：跟进次数是「本轮线索跟了几次」的预算。不重置的话，
 * 重开的线索会带着上一轮的额度直接撞上限，永远轮不到被跟进 —— 那等于什么都没重开。
 *
 * 不改表结构：只动 leadStage / followUpCount / version 这三个已有字段，
 * 留痕靠 version 递增 + 阶段时间线（AgentRun 本身就是变更记录）。
 */
export async function reopenTerminalState(
  tenantId: string,
  customerId: string,
): Promise<ReopenResult> {
  const current = await prisma.customerState.findFirst({ where: { customerId, tenantId } })
  if (!current) return { ok: false, reason: 'not_found' }
  if (!isTerminalStage(current.leadStage as LeadStage)) {
    return { ok: false, reason: 'not_terminal' }
  }

  const updated = await prisma.customerState.update({
    where: { customerId },
    data: {
      leadStage: REOPEN_STAGE,
      followUpCount: 0,
      lastFollowUpAt: null,
      version: { increment: 1 },
    },
  })
  return { ok: true, state: toDTO(updated), from: current.leadStage }
}

// ───────── 内部 ─────────

type StateRow = Prisma.CustomerStateGetPayload<Record<string, never>>

function toDTO(row: StateRow): CustomerStateDTO {
  return {
    leadStage: row.leadStage,
    intent: row.intent,
    purchaseCount: row.purchaseCount,
    needHuman: row.needHuman,
    humanReason: row.humanReason,
    humanResolvedAt: row.humanResolvedAt?.toISOString() ?? null,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    version: row.version,
  }
}

function maxDate(a: Date | null, b: Date): Date {
  if (!a) return b
  return a.getTime() >= b.getTime() ? a : b
}
