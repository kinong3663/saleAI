import type { Prisma } from '@prisma/client'
import { prisma } from '@/server/db'
import type { CustomerDetail, CustomerSummary } from '@/lib/types'
import { listMessages } from './message.service'

const CUSTOMER_LIST_LIMIT = 100

type CustomerWithState = Prisma.CustomerGetPayload<{ include: { state: true } }>

function toSummary(row: CustomerWithState): CustomerSummary {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    channel: row.channel,
    tags: row.tags,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    state: row.state
      ? {
          leadStage: row.state.leadStage,
          intent: row.state.intent,
          needHuman: row.state.needHuman,
          humanReason: row.state.humanReason,
          lastActivityAt: row.state.lastActivityAt?.toISOString() ?? null,
        }
      : null,
  }
}

/** 客户列表：永远带 state（哪怕现在还没有状态行），并按最近活动倒序 */
export async function listCustomers(tenantId: string): Promise<CustomerSummary[]> {
  const rows = await prisma.customer.findMany({
    where: { tenantId, archivedAt: null },
    include: { state: true },
    orderBy: { updatedAt: 'desc' },
    take: CUSTOMER_LIST_LIMIT,
  })
  return rows.map(toSummary)
}

export async function createCustomer(
  tenantId: string,
  input: { name: string; channel?: string; tags?: string },
): Promise<CustomerSummary> {
  const row = await prisma.customer.create({
    data: {
      tenantId,
      name: input.name,
      channel: input.channel ?? 'manual',
      tags: input.tags ?? '',
    },
    include: { state: true },
  })
  return toSummary(row)
}

/**
 * 客户详情 + 会话记录。
 *
 * `where` 里同时带 id 和 tenantId —— 拿租户 A 的 tenantId 查租户 B 的 customerId
 * 会返回 null，路由层转成 404（进阶挑战 4 的验收点）。
 */
export async function getCustomer(
  tenantId: string,
  customerId: string,
): Promise<CustomerDetail | null> {
  const row = await prisma.customer.findFirst({
    where: { id: customerId, tenantId, archivedAt: null },
    include: { state: true },
  })
  if (!row) return null

  const messages = await listMessages(tenantId, customerId)
  return { ...toSummary(row), messages }
}
