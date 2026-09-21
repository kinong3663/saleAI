import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { __setForceFailure, isForceFailure } from '@/server/agent/llm'

export const dynamic = 'force-dynamic'

const ToggleInput = z.object({ enabled: z.boolean() })

/**
 * S7 · 强制故障开关（实施文档 S7 产出；S9 会给它配一个 /dev 页面）。
 *
 * 打开后 callLLM 直接返回失败、不真的发请求 —— 用来演示「AI 挂了系统不崩」。
 * 不要用断网演示：现场不可控（技术栈文档 3.4）。
 *
 * ⚠️ 这个端点没有独立鉴权（决策记录第 3 节假设③已经承认这一点），
 * 所以别在公网上长期暴露：S11 的单口令门锁会把它一起挡住。
 */
export async function GET() {
  return NextResponse.json({ enabled: isForceFailure() })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = ToggleInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  __setForceFailure(parsed.data.enabled)
  return NextResponse.json({ enabled: isForceFailure() })
}
