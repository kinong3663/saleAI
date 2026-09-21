import { NextResponse, type NextRequest } from 'next/server'
import { getRecentAgentRuns } from '@/server/agent/analyze'

export const dynamic = 'force-dynamic'

/** GET /api/customers/:id/runs?tenantId=xxx —— AgentRun 历史（排障 + 状态时间线的数据源） */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tenantId = req.nextUrl.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId_required' }, { status: 400 })
  }

  const { id } = await params
  const limit = Number(req.nextUrl.searchParams.get('take') ?? 20)
  const runs = await getRecentAgentRuns(tenantId, id, Number.isFinite(limit) ? limit : 20)
  return NextResponse.json({ runs })
}
