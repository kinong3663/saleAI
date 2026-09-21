import { Prisma } from '@prisma/client'
import { prisma } from '@/server/db'
import { NotFoundError } from '@/server/errors'
import type { MessageDTO, MessageRoleValue } from '@/lib/types'

/** 会话页一次拉多少条。注意这与 prompt 的 HISTORY_LIMIT（决策 Q9）不是同一个常量。 */
const MESSAGE_PAGE_SIZE = 50

type MessageRow = Prisma.MessageGetPayload<Record<string, never>>

function toDTO(row: MessageRow): MessageDTO {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    role: row.role as MessageRoleValue,
    content: row.content,
    source: row.source,
    clientMsgId: row.clientMsgId,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * 取最近 N 条，返回时是时间正序。
 *
 * 必须是 `orderBy: desc + take` 再 `reverse`：
 * 写成 `asc + take` 拿到的是**最旧**的 20 条，模型和销售都看不到最新消息
 * （技术栈文档第 10 节第 4 条）。
 */
export async function listMessages(
  tenantId: string,
  customerId: string,
  opts: { take?: number } = {},
): Promise<MessageDTO[]> {
  const rows = await prisma.message.findMany({
    where: { tenantId, customerId },
    // createdAt 同毫秒时靠 id 兜底，否则分页顺序不稳定
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.take ?? MESSAGE_PAGE_SIZE,
  })
  return rows.reverse().map(toDTO)
}

/**
 * 写入一条消息。
 *
 * 两件必须做的事：
 * ① 先确认 customerId 属于这个 tenantId —— 否则「用租户 A 的身份给租户 B 的客户发消息」就成了越权写入
 * ② clientMsgId 撞唯一约束时返回已存在的那条（幂等靠数据库约束兜底，不靠应用层 if）
 */
export async function appendMessage(
  tenantId: string,
  customerId: string,
  input: {
    role: MessageRoleValue
    content: string
    source?: string
    clientMsgId?: string
  },
): Promise<MessageDTO> {
  const owned = await prisma.customer.findFirst({
    where: { id: customerId, tenantId, archivedAt: null },
    select: { id: true },
  })
  if (!owned) throw new NotFoundError('customer_not_found')

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.message.create({
        data: {
          tenantId,
          customerId,
          role: input.role,
          content: input.content,
          source: input.source ?? 'manual',
          clientMsgId: input.clientMsgId ?? null,
        },
      })
      // 让这个客户冒到列表顶部（客户列表按 updatedAt 倒序，索引 customers(tenantId, archivedAt, updatedAt)）
      await tx.customer.update({ where: { id: customerId }, data: { updatedAt: new Date() } })
      return row
    })
    return toDTO(created)
  } catch (e) {
    const duplicated =
      input.clientMsgId != null &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    if (duplicated) {
      const existing = await prisma.message.findFirst({
        where: { customerId, clientMsgId: input.clientMsgId },
      })
      if (existing) return toDTO(existing)
    }
    throw e
  }
}
