import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { analyzeCustomerMessage } from '@/server/agent/analyze'
import { NotFoundError } from '@/server/errors'

export const dynamic = 'force-dynamic'

const AnalyzeInput = z.object({
  tenantId: z.string().min(1),
  /** 触发本次判定的那条客户消息；也决定幂等键 */
  triggerMessageId: z.string().min(1),
})

/** POST /api/customers/:id/analyze —— 触发 AI 判定，返回建议卡片 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const body = await req.json().catch(() => null)
  const parsed = AnalyzeInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { id } = await params
  const { tenantId, triggerMessageId } = parsed.data

  try {
    const result = await analyzeCustomerMessage(tenantId, id, {
      trigger: 'CUSTOMER_MESSAGE',
      triggerMessageId,
    })
    return NextResponse.json({
      ok: result.ok,
      reused: result.reused,
      reason: result.reason ?? null,
      run: result.run,
    })
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 })
    }
    throw e
  }
}
