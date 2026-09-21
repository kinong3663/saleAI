import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getTenantDetail, updateTenantBasic } from '@/server/services/tenant.service'

export const dynamic = 'force-dynamic'

const BasicPatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  industry: z.string().trim().max(60).nullable().optional(),
  salesGoal: z.string().trim().min(1).max(300).optional(),
  tone: z.string().trim().max(200).nullable().optional(),
})

/** GET /api/tenants/:id —— 租户详情（含完整 config），配置页用它读 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tenant = await getTenantDetail(id)
  if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 })
  return NextResponse.json({ tenant })
}

/** PATCH /api/tenants/:id —— 只改基本信息（config 走 PUT /api/tenants/:id/config） */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await req.json().catch(() => null)
  const parsed = BasicPatch.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { id } = await params
  const tenant = await updateTenantBasic(id, parsed.data)
  if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 })
  return NextResponse.json({ tenant })
}
