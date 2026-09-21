import { prisma } from '@/server/db'
import type { TenantDTO } from '@/lib/types'

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
