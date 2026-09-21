import { NextResponse } from 'next/server'
import { listTenants } from '@/server/services/tenant.service'

export const dynamic = 'force-dynamic'

/** GET /api/tenants —— 顶部租户切换器的数据源 */
export async function GET() {
  const tenants = await listTenants()
  return NextResponse.json({ tenants })
}
