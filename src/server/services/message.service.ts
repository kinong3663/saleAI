import { Prisma } from '@prisma/client'
import { prisma } from '@/server/db'
import { NotFoundError } from '@/server/errors'
import type { AgentOutput, MessageDTO, MessageRoleValue } from '@/lib/types'
import { markSalesReplySent } from './state.service'

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

/** clientMsgId 撞唯一约束 = 这条消息已经写过了（前端重试、双击） */
function isDuplicateClientMsgId(e: unknown, clientMsgId?: string | null): boolean {
  return (
    clientMsgId != null &&
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === 'P2002'
  )
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
 * 写入一条消息（CUSTOMER / SYSTEM 用；SALES 请走 sendSalesReply）。
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
    if (isDuplicateClientMsgId(e, input.clientMsgId)) {
      const existing = await prisma.message.findFirst({
        where: { customerId, clientMsgId: input.clientMsgId },
      })
      if (existing) return toDTO(existing)
    }
    throw e
  }
}

export interface SendSalesReplyInput {
  content: string
  /** 销售这次回复的是哪一条 AI 建议；带上它才能回填 suggestionSent / suggestionEdited */
  runId?: string | null
  clientMsgId?: string | null
}

export interface SendSalesReplyResult {
  message: MessageDTO
  source: string
  suggestionEdited: boolean
  /** true 表示这次是重复提交，返回的是已存在的那条（没有二次改状态） */
  duplicated: boolean
}

/**
 * 销售发送（S5 关键点）—— **这是写 SALES 消息的唯一入口**。
 * 通用 messages 接口收到 role=SALES 时也必须转到这里，否则会绕过下面这个事务：
 *
 * 一个事务里做四件事：
 *   ① 写 SALES 消息  ② 更新 lastSalesMessageAt / lastActivityAt  ③ 回填 suggestionSent / suggestionEdited
 *   ④ 顶一下 customer.updatedAt（列表排序用）
 *
 * source 的取值：带了 runId 就是 ai_suggested（哪怕销售改过字），否则是 manual。
 * 「改过没有」不靠前端声明，而是拿 sent 的内容和 AgentRun.output.reply 比 —— 前端可以撒谎，
 * 数据库里的两份内容不会。
 *
 * clientMsgId 撞唯一约束 → 返回已存在的那条（前端重试/双击不该写成两条，也不该报 500）。
 */
export async function sendSalesReply(
  tenantId: string,
  customerId: string,
  input: SendSalesReplyInput,
): Promise<SendSalesReplyResult> {
  const owned = await prisma.customer.findFirst({
    where: { id: customerId, tenantId, archivedAt: null },
    select: { id: true },
  })
  if (!owned) throw new NotFoundError('customer_not_found')

  let run = null
  if (input.runId) {
    run = await prisma.agentRun.findFirst({
      where: { id: input.runId, tenantId, customerId },
    })
    if (!run) throw new NotFoundError('agent_run_not_found')
  }

  const suggestedReply = ((run?.output ?? null) as AgentOutput | null)?.reply ?? null
  const source = run ? 'ai_suggested' : 'manual'
  const editedComparedTo = (content: string) =>
    suggestedReply !== null && suggestedReply.trim() !== content.trim()
  const at = new Date()

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.message.create({
        data: {
          tenantId,
          customerId,
          role: 'SALES',
          content: input.content,
          source,
          clientMsgId: input.clientMsgId ?? null,
          createdAt: at,
        },
      })
      await markSalesReplySent(tenantId, customerId, at, tx)
      if (run) {
        await tx.agentRun.update({
          where: { id: run.id },
          data: { suggestionSent: true, suggestionEdited: editedComparedTo(input.content) },
        })
      }
      await tx.customer.update({ where: { id: customerId }, data: { updatedAt: at } })
      return row
    })
    return {
      message: toDTO(created),
      source,
      suggestionEdited: editedComparedTo(input.content),
      duplicated: false,
    }
  } catch (e) {
    // 重复提交：事务已整体回滚（状态没被改第二次），返回已存在的那条
    if (isDuplicateClientMsgId(e, input.clientMsgId)) {
      const existing = await prisma.message.findFirst({
        where: { customerId, clientMsgId: input.clientMsgId },
      })
      if (existing) {
        return {
          message: toDTO(existing),
          source: existing.source,
          suggestionEdited: editedComparedTo(existing.content),
          duplicated: true,
        }
      }
    }
    throw e
  }
}
