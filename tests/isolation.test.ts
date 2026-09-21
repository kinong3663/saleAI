import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/server/db'
import { NotFoundError } from '@/server/errors'
import {
  createCustomer,
  getCustomer,
  getCustomerState,
  listCustomers,
} from '@/server/services/customer.service'
import { appendMessage, listMessages } from '@/server/services/message.service'

/**
 * 租户边界（进阶挑战 4）。
 *
 * 为什么必须有这个测试：这是唯一一个「写错了也不会报错、但会真出事」的地方 ——
 * 少写一个 tenantId，页面照样跑，只是别人的客户数据泄漏给了你。
 * 所以这里不测 happy path，专测「拿租户 A 的身份去够租户 B 的东西」必须够不到。
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

let tenantA = ''
let tenantB = ''
let customerA = ''
let customerB = ''

beforeAll(async () => {
  const a = await prisma.tenant.create({
    data: { slug: `it-a-${suffix}`, name: `隔离测试A-${suffix}`, salesGoal: '测试', config: TENANT_CONFIG },
  })
  const b = await prisma.tenant.create({
    data: { slug: `it-b-${suffix}`, name: `隔离测试B-${suffix}`, salesGoal: '测试', config: TENANT_CONFIG },
  })
  tenantA = a.id
  tenantB = b.id

  customerA = (await createCustomer(tenantA, { name: 'A 的客户' })).id
  customerB = (await createCustomer(tenantB, { name: 'B 的客户' })).id

  // B 的客户有一条真实消息 —— 用来验证「A 读不到 B 的消息」
  await appendMessage(tenantB, customerB, {
    role: 'CUSTOMER',
    content: 'B 租户的机密对话',
    clientMsgId: `it-${suffix}-b1`,
  })
})

afterAll(async () => {
  // 删租户会级联删掉客户 / 消息 / 状态，不需要逐个清
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } })
  await prisma.$disconnect()
})

describe('读：拿 A 的 tenantId 去够 B 的 customerId', () => {
  it('getCustomerState → null（文档里的示例断言）', async () => {
    expect(await getCustomerState(tenantA, customerB)).toBeNull()
  })

  it('getCustomer → null（连消息一起拿不到）', async () => {
    expect(await getCustomer(tenantA, customerB)).toBeNull()
  })

  it('listCustomers(A) 里没有 B 的客户', async () => {
    const rows = await listCustomers(tenantA)
    expect(rows.map((c) => c.id)).toContain(customerA)
    expect(rows.map((c) => c.id)).not.toContain(customerB)
  })

  it('listMessages(A, B 的客户) → 空数组，不泄漏对话内容', async () => {
    expect(await listMessages(tenantA, customerB)).toEqual([])
  })
})

describe('写：跨租户写入必须被拒绝', () => {
  it('拿 A 的身份给 B 的客户写消息 → NotFoundError', async () => {
    await expect(
      appendMessage(tenantA, customerB, { role: 'CUSTOMER', content: '越权写入' }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('越权写入失败后，B 的客户消息数没有变化', async () => {
    const rows = await listMessages(tenantB, customerB)
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe('B 租户的机密对话')
  })
})

describe('自证：同一租户内一切正常', () => {
  it('A 查自己的客户拿得到', async () => {
    const state = await getCustomerState(tenantA, customerA)
    expect(state?.id).toBe(customerA)
  })
})
