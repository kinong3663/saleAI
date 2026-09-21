import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { NotFoundError } from '@/server/errors'
import { appendMessage, sendSalesReply } from '@/server/services/message.service'

export const dynamic = 'force-dynamic'

const AppendMessageInput = z.object({
  tenantId: z.string().min(1),
  role: z.enum(['CUSTOMER', 'SALES', 'SYSTEM']),
  content: z.string().trim().min(1).max(2000),
  source: z.string().max(30).optional(),
  clientMsgId: z.string().max(64).optional(),
  /** role=SALES 时可以带上「回复的是哪条 AI 建议」，用于回填采纳情况 */
  runId: z.string().min(1).optional(),
})

/**
 * POST /api/customers/:id/messages —— CUSTOMER / SALES 通用，clientMsgId 幂等。
 *
 * ⚠️ role=SALES 不会被「裸写」进库：它转给 sendSalesReply，走同一条事务
 * （更新 lastSalesMessageAt / lastActivityAt、回填 suggestionSent / suggestionEdited）。
 * 否则跟进扫描依赖的 `lastSalesMessageAt > lastCustomerMessageAt` 会被绕过，
 * 而 S8 的「客户没回我」判定正建立在这个时间戳上。
 * 这条路径的 source 由 runId 推导（带 runId = ai_suggested，否则 manual），
 * 请求体里的 source 对 SALES 无效。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const body = await req.json().catch(() => null)
  const parsed = AppendMessageInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { id } = await params
  const { tenantId, role, content, source, clientMsgId, runId } = parsed.data

  try {
    if (role === 'SALES') {
      const result = await sendSalesReply(tenantId, id, { content, runId, clientMsgId })
      return NextResponse.json(
        {
          message: result.message,
          source: result.source,
          suggestionEdited: result.suggestionEdited,
          duplicated: result.duplicated,
        },
        { status: 201 },
      )
    }

    const message = await appendMessage(tenantId, id, { role, content, source, clientMsgId })
    return NextResponse.json({ message }, { status: 201 })
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 })
    }
    throw e
  }
}
