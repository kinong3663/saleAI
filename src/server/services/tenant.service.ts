import { prisma } from '@/server/db'
import type { TenantConfig, TenantDTO, TenantForAgent } from '@/lib/types'

/**
 * 租户目录。
 *
 * 这是全项目唯一一个不带 tenantId 的读取 —— 它本身就是隔离的根：
 * 顶部切换器必须先知道「有哪些租户可选」，别的查询一律以 tenantId 开头。
 */
export async function listTenants(): Promise<TenantDTO[]> {
  return prisma.tenant.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, slug: true, name: true },
  })
}

/** 校验 tenantId 是否真实存在（创建客户、进入工作台前都要先过这一关） */
export async function getTenant(tenantId: string): Promise<TenantDTO | null> {
  return prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, slug: true, name: true },
  })
}

/**
 * agent pipeline 用的租户视图：名字 + 目标 + 语气 + 全部 config。
 *
 * config 是 JSONB，这里补默认值再往下传 —— 演示时会现场改规则，
 * 少一个字段不该让整条链路 500。
 */
export async function getTenantForAgent(tenantId: string): Promise<TenantForAgent | null> {
  const row = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, salesGoal: true, tone: true, config: true },
  })
  if (!row) return null

  const raw = (row.config ?? {}) as Partial<TenantConfig>
  const config: TenantConfig = {
    rules: raw.rules ?? [],
    stageDefs: raw.stageDefs ?? {},
    needHumanTriggers: raw.needHumanTriggers ?? [],
    replyTone: raw.replyTone,
    priceFallbackReply:
      raw.priceFallbackReply ?? '这个问题我需要请同事帮你确认一下，稍等我回复你～',
    followUpAfterHours: raw.followUpAfterHours ?? 24,
    maxFollowUps: raw.maxFollowUps ?? 2,
    products: raw.products ?? [],
  }

  return {
    id: row.id,
    name: row.name,
    salesGoal: row.salesGoal,
    tone: row.tone,
    config,
  }
}
