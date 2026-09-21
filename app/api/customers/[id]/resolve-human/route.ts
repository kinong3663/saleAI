import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { resolveHuman } from '@/server/services/state.service'

export const dynamic = 'force-dynamic'

const ResolveInput = z.object({ tenantId: z.string().min(1) })

/** POST /api/customers/:id/resolve-human —— 解除人工（棘轮的必要出口，决策 Q4） */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const body = await req.json().catch(() => null)
  const parsed = ResolveInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { id } = await params
  const state = await resolveHuman(parsed.data.tenantId, id)
  if (!state) {
    return NextResponse.json({ error: 'state_not_found' }, { status: 404 })
  }
  return NextResponse.json({ state })
}
