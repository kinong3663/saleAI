import { after, NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { scheduleAnalyze } from '@/server/agent/scheduler'
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
 *
 * ⚠️ AI 判定**不在这个请求里**（依据 docs/消息触发时序.md）：
 * 写完客户消息后立刻返回，判定交给 after() 在响应之后按 B 路径跑。
 * 模型的 5~15 秒延迟会被用户感知成"消息发不出去"，所以发送路径必须干净。
 * 用 after() 而不是裸的 void fn() —— 后者异常时是 unhandled rejection。
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

    // 客户消息：判定放到响应之后，且带 3 秒防抖（连发多条只分析最后一次）
    if (role === 'CUSTOMER') {
      after(() => scheduleAnalyze(tenantId, id, message.id))
    }

    return NextResponse.json({ message }, { status: 201 })
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 })
    }
    throw e
  }
}
