import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createCustomer, listCustomers } from '@/server/services/customer.service'
import { getTenant } from '@/server/services/tenant.service'

export const dynamic = 'force-dynamic'

const CreateCustomerInput = z.object({
  tenantId: z.string().min(1),
  name: z.string().trim().min(1).max(50),
  channel: z.string().min(1).max(20).optional(),
  tags: z.string().max(200).optional(),
})

/** GET /api/customers?tenantId=xxx */
export async function GET(req: NextRequest) {
  // 第一行解析 tenantId（技术栈文档第 5 节）
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId_required' }, { status: 400 })
  }
  const customers = await listCustomers(tenantId)
  return NextResponse.json({ customers })
}

/** POST /api/customers */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = CreateCustomerInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { tenantId, name, channel, tags } = parsed.data
  const tenant = await getTenant(tenantId)
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 })
  }

  const customer = await createCustomer(tenantId, { name, channel, tags })
  return NextResponse.json({ customer }, { status: 201 })
}
