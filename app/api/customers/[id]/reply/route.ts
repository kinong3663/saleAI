import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { NotFoundError } from '@/server/errors'
import { sendSalesReply } from '@/server/services/message.service'

export const dynamic = 'force-dynamic'

const ReplyInput = z.object({
  tenantId: z.string().min(1),
  content: z.string().trim().min(1).max(2000),
  /** 销售回复的是哪条 AI 建议 —— 带它才会回填 suggestionSent / suggestionEdited */
  runId: z.string().min(1).optional(),
  clientMsgId: z.string().max(64).optional(),
})

/** POST /api/customers/:id/reply —— 销售确认发送（写 SALES 消息 + 更新状态 + 回填采纳情况） */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const body = await req.json().catch(() => null)
  const parsed = ReplyInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { id } = await params
  const { tenantId, content, runId, clientMsgId } = parsed.data

  try {
    const result = await sendSalesReply(tenantId, id, { content, runId, clientMsgId })
    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 })
    }
    throw e
  }
}
