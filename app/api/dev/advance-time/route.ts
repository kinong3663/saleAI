import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/server/db'

export const dynamic = 'force-dynamic'

const AdvanceInput = z.object({
  /** 往前拨多少小时（最多 30 天，够演示用了） */
  hours: z.number().positive().max(24 * 30),
  /** 指定客户；不传就看 tenantId；都不传 = 全场快进 */
  customerId: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
})

/**
 * S9 · 时间快进（演示用）。
 *
 * 只拨**扫描会读的那两个时间戳**：
 *   · lastActivityAt —— 跟进阈值的时间锚点（决策 Q7）
 *   · lastFollowUpAt —— 第二次跟进的锚点（间隔递增）
 *
 * 刻意**不动** lastSalesMessageAt / lastCustomerMessageAt：这两个字段的先后关系就是
 * 「客户没回我 vs 我还没回客户」的业务语义（决策 Q7）。把它们一起拨，判定会变形，
 * 演示就变成造假了。
 *
 * 也不动 version：version 记的是「业务状态变更次数」，时间快进是调试手段，不是业务变更。
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = AdvanceInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { hours, customerId, tenantId } = parsed.data
  const shiftMs = hours * 3_600_000
  const scope = customerId ? 'customer' : tenantId ? 'tenant' : 'all'

  const where = customerId ? { customerId } : tenantId ? { tenantId } : {}
  const states = await prisma.customerState.findMany({
    where,
    select: { customerId: true, lastActivityAt: true, lastFollowUpAt: true, customer: { select: { name: true } } },
    take: 500,
  })

  const moved: { customerId: string; name: string; lastActivityAt: string | null }[] = []
  for (const state of states) {
    const nextActivity = state.lastActivityAt
      ? new Date(state.lastActivityAt.getTime() - shiftMs)
      : null
    const updated = await prisma.customerState.update({
      where: { customerId: state.customerId },
      data: {
        lastActivityAt: nextActivity,
        lastFollowUpAt: state.lastFollowUpAt
          ? new Date(state.lastFollowUpAt.getTime() - shiftMs)
          : null,
      },
      select: { customerId: true, lastActivityAt: true },
    })
    moved.push({
      customerId: updated.customerId,
      name: state.customer.name,
      lastActivityAt: updated.lastActivityAt?.toISOString() ?? null,
    })
  }

  return NextResponse.json({ scope, hours, updated: moved.length, moved: moved.slice(0, 10) })
}
