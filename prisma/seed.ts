// S1 · 只初始化两个租户，不初始化客户（决策 Q8：演示客户现场创建）
// 依据：docs/实施文档.md Part 1.5
//
// S6 追加：SEED_ONLY_IF_EMPTY=true 时，库里已经有租户就直接退出。
// 这样容器启动脚本可以安全地每次都跑 seed —— 服务器重启不会把演示现场改过的规则覆盖回去。
import { PrismaClient, type Prisma } from '@prisma/client'

const prisma = new PrismaClient()

const TENANTS = [
  {
    slug: 'swimming',
    name: '乐蒙亲子游泳',
    industry: '亲子游泳教育',
    salesGoal: '推动客户预约线下体验课。',
    tone: '亲切、简短、口语化，不超过 80 字，多用「你」少用「您」。',
    config: {
      rules: [
        {
          id: 'R1',
          type: 'PROHIBIT',
          text: '客户未表达明确兴趣前，不主动报价',
          enforcement: { kind: 'FORBID_PRICE_UNTIL', condition: 'INTEREST_EXPRESSED' },
        },
        {
          id: 'R2',
          type: 'REQUIRE',
          text: '客户说「贵 / 考虑一下」时，先给价值锚点（安全、教练资质、体验课）或已成交案例，不降价',
        },
        {
          id: 'R3',
          type: 'PREFER',
          text: '优先引导到店体验，而不是线上长时间答疑',
        },
      ],
      stageDefs: {
        NEW: '首次接触，尚未表达需求',
        DISCOVERY: '正在了解，需求不明确',
        INTERESTED: '已表达具体兴趣（问价格 / 时间 / 产品细节）',
        HIGH_INTENT: '已约好线下体验时间',
        WON: '已成交或已到店',
        LOST: '明确拒绝或长期无响应',
      },
      needHumanTriggers: ['投诉', '要求真人', '涉及退款', 'AI 无法确认答案'],
      priceFallbackReply:
        '具体价格跟课程类型和课时有关，我先了解一下孩子的情况，再给你准确的推荐，可以吗？',
      followUpAfterHours: 24,
      maxFollowUps: 2,
      // 引流品可自动报，大单必须人工谈 —— 报价的"对象维度"
      products: [
        {
          id: 'P1',
          name: '亲子游泳体验课',
          price: 198,
          unit: '元/次',
          description: '含 1 次体验课 + 1 次体质评估',
          quotePolicy: 'AUTO',
          enabled: true,
        },
        {
          id: 'P2',
          name: '24 课时课包',
          price: 4680,
          unit: '元',
          description: '含 24 次课 + 阶段性评估',
          quotePolicy: 'HUMAN_ONLY',
          enabled: true,
        },
      ],
    },
  },
  {
    slug: 'machinery',
    name: '机械之家',
    industry: '工程机械维修',
    salesGoal: '获取客户车辆资料，以便技师给出准确报价。',
    tone: '干脆、专业、不绕弯，不超过 80 字。',
    config: {
      rules: [
        {
          id: 'R1',
          type: 'REQUIRE',
          text: '确认客户存在设备 + 保险需求后，优先索取行驶证照片',
        },
        {
          id: 'R2',
          type: 'PROHIBIT',
          text: '未取得行驶证信息前，不给出具体维修报价',
          enforcement: { kind: 'FORBID_PRICE_UNTIL', condition: 'DOCUMENT_CONFIRMED' },
        },
        {
          id: 'R3',
          type: 'PREFER',
          text: '用「技师需要看车才能给准价」作为索取资料的理由',
        },
      ],
      stageDefs: {
        NEW: '首次接触，尚未表达需求',
        DISCOVERY: '正在了解设备情况，需求不明确',
        INTERESTED: '已表达具体兴趣（问价格 / 维修方案 / 工期）',
        HIGH_INTENT: '已同意提供行驶证照片',
        WON: '已送修或已确认订单',
        LOST: '明确拒绝或长期无响应',
      },
      needHumanTriggers: ['投诉', '要求真人', '涉及退款', '纠纷'],
      priceFallbackReply:
        '维修价得看车况才能定。你把行驶证拍给我，我让技师先看车型，大概区间就能给你。',
      followUpAfterHours: 48,
      maxFollowUps: 2,
      // 没有价格的产品是合法状态：维修价必须技师看车后才能给
      products: [
        {
          id: 'P1',
          name: '保险理赔维修',
          description: '需技师看车、核对行驶证后报价',
          quotePolicy: 'AUTO',
          enabled: true,
        },
      ],
    },
  },
] as const

async function main() {
  if (process.env.SEED_ONLY_IF_EMPTY === 'true') {
    const existing = await prisma.tenant.count()
    if (existing > 0) {
      console.log(`seed skipped: ${existing} tenant(s) already present`)
      return
    }
  }

  for (const t of TENANTS) {
    await prisma.tenant.upsert({
      where: { slug: t.slug },
      // `as const` 的 readonly 数组在 Prisma 的 Json 输入类型里不合法，这里只做类型收窄，值不变
      create: { ...t, config: t.config as unknown as Prisma.InputJsonValue },
      update: {
        name: t.name,
        salesGoal: t.salesGoal,
        tone: t.tone,
        config: t.config as unknown as Prisma.InputJsonValue,
      },
    })
    console.log(`  ✓ tenant ${t.slug} — ${t.name}`)
  }
  console.log('seed done: 2 tenants, 0 customers')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
