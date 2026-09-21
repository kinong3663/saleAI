import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { reopenTerminalState } from '@/server/services/state.service'

export const dynamic = 'force-dynamic'

const ReopenInput = z.object({ tenantId: z.string().min(1) })

/**
 * POST /api/customers/:id/reopen —— 重新激活（终态锁 G1 的人工出口）。
 *
 * 与 /resolve-human 同构：一个不可逆状态配一个人工出口。
 * 区别是这里会拒绝非终态客户（409），而解除人工只是幂等地把开关拨回 false。
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const body = await req.json().catch(() => null)
  const parsed = ReopenInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { id } = await params
  const result = await reopenTerminalState(parsed.data.tenantId, id)

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return NextResponse.json({ error: 'state_not_found' }, { status: 404 })
    }
    return NextResponse.json(
      { error: 'not_terminal_stage', hint: '只有 WON / LOST 的客户才需要重新激活' },
      { status: 409 },
    )
  }

  return NextResponse.json({ state: result.state, from: result.from })
}
