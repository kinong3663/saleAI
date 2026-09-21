import { isTerminalStage, type LeadStage } from '@/lib/constants'
import type { TenantConfig } from '@/lib/types'
import { analyzeCustomerMessage } from '@/server/agent/analyze'
import { prisma } from '@/server/db'
import { getTenantForAgent } from '@/server/services/tenant.service'

/**
 * Follow-up（进阶挑战 1）：把「客户聊一半不回了」这件事变成一条主动的跟进建议。
 *
 * 设计依据（决策 Q6 / Q7 / Q12 / Q13）：
 *   · 触发机制：进程内 setInterval(60s) + 手动接口，共用 runFollowUpScan()（Q6）
 *   · 跟进条件：超时**且最后一条是 SALES 发的** —— 「客户没回我」才是跟进，
 *     「我还没回客户」是 SLA 违规，该走催办告警（Q7）
 *   · 复用同一条 pipeline，只换 trigger（Q12）
 *   · 判定结果不写回 leadStage / intent，只更新 lastFollowUpAt / followUpCount（Q13）
 */

/** 一次扫描最多看多少个客户状态（防止全表扫） */
const SCAN_STATE_LIMIT = 500

export interface FollowUpStateView {
  leadStage: string
  needHuman: boolean
  followUpCount: number
  lastFollowUpAt: Date | null
  lastCustomerMessageAt: Date | null
  lastSalesMessageAt: Date | null
  lastActivityAt: Date | null
}

export interface FollowUpDecision {
  followUp: boolean
  /** 给人看的一句话理由（跳过原因也会写在这里） */
  reason: string
  /** 本次要求的最小间隔（小时）：base × (已跟进次数 + 1) */
  requiredHours: number
  /** 实际已经等了多久（小时） */
  waitedHours: number
}

/**
 * 纯函数：要不要跟进（实施文档 S8 明确要求「写成纯函数，方便单测和讲解」）。
 *
 * 时间锚点的选择：**优先 lastFollowUpAt，没有才用 lastActivityAt**。
 * 这不是随手定的 —— 验收要求「连点两次只产生一条跟进」：如果锚点只看 lastActivityAt，
 * 一个已经沉默 3 天的客户会在第二次扫描时再次命中。用 lastFollowUpAt 当锚点 +
 * 间隔随次数递增，才同时满足「到点要跟进」和「不能连着骚扰」。
 */
export function shouldFollowUp(
  state: FollowUpStateView,
  config: TenantConfig,
  now: Date,
): FollowUpDecision {
  const requiredHours = config.followUpAfterHours * (state.followUpCount + 1) // 间隔递增
  const anchor = state.lastFollowUpAt ?? state.lastActivityAt
  const waitedHours = anchor ? (now.getTime() - anchor.getTime()) / 3_600_000 : 0
  const skip = (reason: string): FollowUpDecision => ({
    followUp: false,
    reason,
    requiredHours,
    waitedHours,
  })

  // ── 排除项（决策 Q7） ──
  if (isTerminalStage(state.leadStage as LeadStage)) {
    return skip(state.leadStage === 'WON' ? '客户已成交，不再跟进' : '客户已流失，不再跟进')
  }
  if (state.needHuman) {
    return skip('已转人工，等人处理（AI 不应在人工介入后再插一句）')
  }
  if (state.followUpCount >= config.maxFollowUps) {
    return skip(`已跟进 ${state.followUpCount} 次，达到本租户上限 ${config.maxFollowUps}`)
  }

  // ── 核心条件：最后一条必须是 SALES 发的（决策 Q7） ──
  if (!state.lastSalesMessageAt) {
    return skip('我们还没回过客户 —— 这不是跟进，是还没开始服务')
  }
  if (!state.lastCustomerMessageAt) {
    return skip('没有客户消息记录，无法判断是否沉默')
  }
  if (state.lastSalesMessageAt.getTime() <= state.lastCustomerMessageAt.getTime()) {
    return skip('最后一条是客户发的 —— 我们欠客户一个回复，属于 SLA 问题，不能当成跟进')
  }

  // ── 到点没有（间隔递增：base × (次数 + 1)） ──
  if (!anchor) {
    return skip('没有可用的时间锚点')
  }
  if (waitedHours < requiredHours) {
    return skip(
      `还没到跟进时机：已等 ${waitedHours.toFixed(1)}h，需要 ${requiredHours}h（第 ${state.followUpCount + 1} 次跟进）`,
    )
  }

  return {
    followUp: true,
    reason: `客户已沉默 ${waitedHours.toFixed(1)}h（≥ ${requiredHours}h），且最后一条是我们发的`,
    requiredHours,
    waitedHours,
  }
}

export interface FollowUpScanResult {
  scannedTenants: number
  scannedStates: number
  followedUp: {
    tenantId: string
    customerId: string
    customerName: string
    runId: string
    status: string
    reply: string
    waitedHours: number
  }[]
  skipped: { tenantId: string; customerId: string; customerName: string; reason: string }[]
  failed: { tenantId: string; customerId: string; error: string }[]
  startedAt: string
  finishedAt: string
}

/**
 * 扫一遍所有租户，给该跟进的客户生成跟进建议。
 * 定时器（startup.ts）和手动接口（/api/followups/scan）共用这一个函数（决策 Q6）。
 */
export async function runFollowUpScan(now: Date = new Date()): Promise<FollowUpScanResult> {
  const startedAt = now.toISOString()
  const followedUp: FollowUpScanResult['followedUp'] = []
  const skipped: FollowUpScanResult['skipped'] = []
  const failed: FollowUpScanResult['failed'] = []
  let scannedStates = 0

  const tenants = await prisma.tenant.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } })

  for (const tenant of tenants) {
    const tenantForAgent = await getTenantForAgent(tenant.id)
    if (!tenantForAgent) continue
    const config = tenantForAgent.config

    // 粗筛只排除「归档客户」，具体条件全部交给纯函数 —— 这样 skipped 里能看到每个人为什么被跳过
    const states = await prisma.customerState.findMany({
      where: { tenantId: tenant.id, customer: { archivedAt: null } },
      include: { customer: { select: { id: true, name: true } } },
      orderBy: { lastActivityAt: 'asc' },
      take: SCAN_STATE_LIMIT,
    })
    scannedStates += states.length

    for (const state of states) {
      const decision = shouldFollowUp(
        {
          leadStage: state.leadStage,
          needHuman: state.needHuman,
          followUpCount: state.followUpCount,
          lastFollowUpAt: state.lastFollowUpAt,
          lastCustomerMessageAt: state.lastCustomerMessageAt,
          lastSalesMessageAt: state.lastSalesMessageAt,
          lastActivityAt: state.lastActivityAt,
        },
        config,
        now,
      )

      if (!decision.followUp) {
        skipped.push({
          tenantId: tenant.id,
          customerId: state.customerId,
          customerName: state.customer.name,
          reason: decision.reason,
        })
        continue
      }

      // ── 幂等：CAS 抢这条跟进（不靠「扫描只跑一次」的假设） ──
      const claimed = await prisma.customerState.updateMany({
        where: { customerId: state.customerId, followUpCount: state.followUpCount, needHuman: false },
        data: { followUpCount: { increment: 1 }, lastFollowUpAt: now },
      })
      if (claimed.count === 0) {
        skipped.push({
          tenantId: tenant.id,
          customerId: state.customerId,
          customerName: state.customer.name,
          reason: '另一处扫描已经抢先处理（CAS 未命中，跳过以保持幂等）',
        })
        continue
      }

      // ── 复用同一条 pipeline，只换 trigger（决策 Q12） ──
      try {
        const result = await analyzeCustomerMessage(tenant.id, state.customerId, {
          trigger: 'FOLLOW_UP',
          triggerMessageId: null,
        })
        followedUp.push({
          tenantId: tenant.id,
          customerId: state.customerId,
          customerName: state.customer.name,
          runId: result.run.id,
          status: result.run.status,
          reply: result.run.output?.reply ?? '',
          waitedHours: Number(decision.waitedHours.toFixed(1)),
        })
      } catch (e) {
        failed.push({
          tenantId: tenant.id,
          customerId: state.customerId,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  return {
    scannedTenants: tenants.length,
    scannedStates,
    followedUp,
    skipped,
    failed,
    startedAt,
    finishedAt: new Date().toISOString(),
  }
}
