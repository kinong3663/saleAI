import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { NotFoundError } from '@/server/errors'
import { appendMessage } from '@/server/services/message.service'

export const dynamic = 'force-dynamic'

const AppendMessageInput = z.object({
  tenantId: z.string().min(1),
  role: z.enum(['CUSTOMER', 'SALES', 'SYSTEM']),
  content: z.string().trim().min(1).max(2000),
  source: z.string().max(30).optional(),
  clientMsgId: z.string().max(64).optional(),
})

/** POST /api/customers/:id/messages —— CUSTOMER / SALES 通用，clientMsgId 幂等 */
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
  const { tenantId, role, content, source, clientMsgId } = parsed.data

  try {
    const message = await appendMessage(tenantId, id, { role, content, source, clientMsgId })
    return NextResponse.json({ message }, { status: 201 })
  } catch (e) {
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 })
    }
    throw e
  }
}
