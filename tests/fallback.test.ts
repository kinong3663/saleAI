import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyzeCustomerMessage } from '@/server/agent/analyze'
import { __setForceFailure } from '@/server/agent/llm'
import type { AgentOutputLoose } from '@/server/agent/schema'
import { prisma } from '@/server/db'
import { createCustomer, getCustomerState } from '@/server/services/customer.service'
import { appendMessage } from '@/server/services/message.service'
import { applyAnalysisToState } from '@/server/services/state.service'

/**
 * 降级路径（S7 的设计重点）。
 *
 * 为什么值得测：这是「AI 挂了系统不崩」这条要求的唯一证据，
 * 而且它平时永远不触发 —— 没有测试，你根本不知道这条路是活的还是死的。
 *
 * 用 /dev 那个强制故障开关来制造失败（技术栈文档 3.4 就是为这个场景准备的），
 * 所以这个测试不联网、不花钱、结果确定。
 */

const suffix = Math.random().toString(36).slice(2, 8)
const TENANT_CONFIG = {
  rules: [],
  stageDefs: {},
  needHumanTriggers: [],
  priceFallbackReply: '我请同事确认一下',
  followUpAfterHours: 24,
  maxFollowUps: 2,
  products: [],
}

const BASELINE: AgentOutputLoose = {
  customer_intent: '询价',
  lead_stage: 'INTERESTED',
  next_action: '回答问题',
  reply: '这个是基准状态',
  reason: '测试铺的基线',
  need_human: false,
  human_trigger: '',
  rules_hit: [],
  confidence: 0.9,
}

let tenantId = ''
let customerId = ''
let triggerMessageId = ''

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: { slug: `fb-${suffix}`, name: `降级测试-${suffix}`, salesGoal: '测试', config: TENANT_CONFIG },
  })
  tenantId = tenant.id
  customerId = (await createCustomer(tenantId, { name: '降级测试客户' })).id
  triggerMessageId = (
    await appendMessage(tenantId, customerId, {
      role: 'CUSTOMER',
      content: '你们体验课多少钱？',
      clientMsgId: `fb-${suffix}-1`,
    })
  ).id

  // 基线状态直接写库，避免测试里调真实模型（慢、贵、不确定）
  await applyAnalysisToState(tenantId, customerId, {
    trigger: 'CUSTOMER_MESSAGE',
    output: BASELINE,
    at: new Date(),
  })
})

afterAll(async () => {
  __setForceFailure(false)
  await prisma.tenant.deleteMany({ where: { id: tenantId } })
  await prisma.$disconnect()
})

describe('AI 调用失败时的降级路径', () => {
  it('强制故障下：AgentRun 记为 FALLBACK 且 error 说明原因', async () => {
    __setForceFailure(true)
    try {
      const result = await analyzeCustomerMessage(tenantId, customerId, {
        trigger: 'CUSTOMER_MESSAGE',
        triggerMessageId,
      })

      expect(result.ok).toBe(false)
      expect(result.fallback).toBe(true)
      expect(result.run.status).toBe('FALLBACK')
      expect(result.run.error ?? '').toContain('forced_failure')

      // 降级输出本身要有可执行的内容：转人工 + 一句能发出去的话
      expect(result.run.output?.need_human).toBe(true)
      expect(result.run.output?.next_action).toBe('转人工')
      expect((result.run.output?.reply ?? '').length).toBeGreaterThan(0)
    } finally {
      __setForceFailure(false)
    }
  })

  it('落库的 AgentRun 也是 FALLBACK（不只看返回值）', async () => {
    const rows = await prisma.agentRun.findMany({ where: { customerId } })
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('FALLBACK')
    expect(rows[0].error ?? '').toContain('forced_failure')
  })

  it('状态不前进：阶段与意图保持基线值', async () => {
    const customer = await getCustomerState(tenantId, customerId)
    expect(customer?.state?.leadStage).toBe('INTERESTED')
    expect(customer?.state?.intent).toBe('询价')
  })

  it('但必须转人工：needHuman 被置为 true（棘轮），version +1', async () => {
    const customer = await getCustomerState(tenantId, customerId)
    expect(customer?.state?.needHuman).toBe(true)
    expect(customer?.state?.version).toBe(2) // 基线 1 次 + 降级 1 次
  })
})
