import type { Prisma } from '@prisma/client'
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
    priceFallbackReply:
      raw.priceFallbackReply ?? '这个问题我需要请同事帮你确认一下，稍等我回复你～',
    followUpAfterHours: raw.followUpAfterHours ?? 24,
    maxFollowUps: raw.maxFollowUps ?? 2,
    // 读取侧净化：历史配置里的产品可能没有 id（老版本只有 name/price），补一个稳定标识
    products: (raw.products ?? [])
      .filter((p) => p && typeof p.name === 'string' && p.name.trim() !== '')
      .map((p, i) => ({ ...p, id: p.id || `P${i + 1}` })),
  }

  return {
    id: row.id,
    name: row.name,
    salesGoal: row.salesGoal,
    tone: row.tone,
    config,
  }
}
// ───────── 配置页（/settings/tenant）用的读写 ─────────

export interface TenantDetailView {
  id: string
  slug: string
  name: string
  industry: string | null
  salesGoal: string
  tone: string | null
  config: TenantConfig
  updatedAt: string
}

/** 租户详情：配置页与 GET /api/tenants/:id 用 */
export async function getTenantDetail(tenantId: string): Promise<TenantDetailView | null> {
  const row = await prisma.tenant.findUnique({ where: { id: tenantId } })
  if (!row) return null
  const raw = (row.config ?? {}) as Partial<TenantConfig>
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    industry: row.industry,
    salesGoal: row.salesGoal,
    tone: row.tone,
    config: {
      rules: raw.rules ?? [],
      stageDefs: raw.stageDefs ?? {},
      needHumanTriggers: raw.needHumanTriggers ?? [],
      priceFallbackReply: raw.priceFallbackReply ?? '',
      followUpAfterHours: raw.followUpAfterHours ?? 24,
      maxFollowUps: raw.maxFollowUps ?? 2,
      products: (raw.products ?? [])
        .filter((p) => p && typeof p.name === 'string' && p.name.trim() !== '')
        .map((p, i) => ({ ...p, id: p.id || `P${i + 1}` })),
    },
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** PUT /api/tenants/:id/config —— 整段替换配置（校验在路由层做） */
export async function replaceTenantConfig(
  tenantId: string,
  config: TenantConfig,
): Promise<TenantDetailView | null> {
  const exists = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
  if (!exists) return null
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { config: config as unknown as Prisma.InputJsonValue },
  })
  return getTenantDetail(tenantId)
}

/** PATCH /api/tenants/:id —— 只改基本信息（基本信息不是 JSONB，单独走） */
export async function updateTenantBasic(
  tenantId: string,
  patch: { name?: string; industry?: string | null; salesGoal?: string; tone?: string | null },
): Promise<TenantDetailView | null> {
  const exists = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
  if (!exists) return null
  await prisma.tenant.update({ where: { id: tenantId }, data: patch })
  return getTenantDetail(tenantId)
}