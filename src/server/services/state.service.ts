import { Prisma } from '@prisma/client'
import { prisma } from '@/server/db'
import type { CustomerStateDTO } from '@/lib/types'
import type { AgentOutputLoose } from '@/server/agent/schema'
import type { Trigger } from '@/lib/constants'

/**
 * CustomerState 的唯一写入方。
 *
 * 三条不能违反的语义：
 * ① needHuman 是**棘轮**：prev.needHuman || 本次判断，AI 无权撤销（决策 Q4）
 * ② 状态迁移只由客户的新输入驱动（决策 Q13）—— 跟进是我们主动说话，客户没提供新信息
 * ③ 每次状态变更 version +1
 */

/** 允许传入事务客户端，让「写状态」和同一次判定产生的 AgentRun 落在同一个事务里 */
export type StateDb = Pick<Prisma.TransactionClient, 'customerState'>

export interface AnalysisStateInput {
  trigger: Trigger
  /** 护栏之后的输出（不是模型原始输出） */
  output: AgentOutputLoose
  /** 触发这次判定的时间，用于 lastCustomerMessageAt / lastActivityAt */
  at: Date
}

export async function applyAnalysisToState(
  tenantId: string,
  customerId: string,
  input: AnalysisStateInput,
  db: StateDb = prisma,
): Promise<void> {
  const current = await db.customerState.findUnique({ where: { customerId } })

  // 决策 Q13：只有「客户发来新消息」才允许推进阶段 / 改意图
  const canAdvance = input.trigger === 'CUSTOMER_MESSAGE'
  const leadStage = canAdvance
    ? input.output.lead_stage
    : (current?.leadStage ?? input.output.lead_stage)
  const intent = canAdvance ? input.output.customer_intent : (current?.intent ?? null)

  // 棘轮：已经在人工手里，就不会被一次「AI 觉得不需要」翻回去
  const needHuman = (current?.needHuman ?? false) || input.output.need_human

  const lastActivityAt = maxDate(current?.lastActivityAt ?? null, input.at)
  const lastCustomerMessageAt = canAdvance
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

// ───────── 内部 ─────────

type StateRow = Prisma.CustomerStateGetPayload<Record<string, never>>

function toDTO(row: StateRow): CustomerStateDTO {
  return {
    leadStage: row.leadStage,
    intent: row.intent,
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
