import { NextResponse, type NextRequest } from 'next/server'
import { getCustomer } from '@/server/services/customer.service'

export const dynamic = 'force-dynamic'

/** GET /api/customers/:id?tenantId=xxx —— 客户详情 + 会话记录 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId_required' }, { status: 400 })
  }

  const { id } = await params
  const customer = await getCustomer(tenantId, id)
  if (!customer) {
    // 不区分「不存在」和「不属于该租户」—— 两者对外都是 404
    return NextResponse.json({ error: 'customer_not_found' }, { status: 404 })
  }
  return NextResponse.json({ customer })
}
