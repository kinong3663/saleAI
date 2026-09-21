import { NextResponse, type NextRequest } from 'next/server'
import { TenantConfigSchema } from '@/lib/tenant-config'
import { replaceTenantConfig } from '@/server/services/tenant.service'

export const dynamic = 'force-dynamic'

/**
 * PUT /api/tenants/:id/config —— 用这份完整配置替换当前配置。
 *
 * 为什么是 PUT 不是 PATCH（配置改造.md §4.1）：PATCH 的语义是"部分更新"，
 * 但 rules / products 是数组 —— 部分更新时到底是替换还是追加？语义不清。
 * 整段替换最可预测，也避免深合并的歧义。
 *
 * 校验用 TenantConfigSchema（§4.2 的三个必查项）：枚举、阶段全覆盖、ID 唯一。
 * 任何一个不过 → 400，把 issues 原样返回给界面显示。
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await req.json().catch(() => null)
  const raw = body && typeof body === 'object' && 'config' in body ? body.config : body
  const parsed = TenantConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_config', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { id } = await params
  const tenant = await replaceTenantConfig(id, parsed.data)
  if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 })
  return NextResponse.json({ tenant })
}
