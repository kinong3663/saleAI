import { NextResponse } from 'next/server'
import { runFollowUpScan } from '@/server/followup'

export const dynamic = 'force-dynamic'

/**
 * POST /api/followups/scan —— 手动触发一次跟进扫描（决策 Q6：与定时器共用同一个函数）。
 * S9 的 /dev 页会给它配一个按钮；在那之前用 curl 也能触发。
 */
export async function POST() {
  const result = await runFollowUpScan()
  return NextResponse.json(result)
}
