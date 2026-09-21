import { describe, expect, it } from 'vitest'
import { AgentOutput, parseAgentOutput } from '@/server/agent/schema'

/**
 * 结构化输出契约。
 * 模型返回的是**不可信输入**：这里测的是「脏数据必须被拒绝、可缺省字段要有兜底」，
 * 不是「模型答得好不好」。契约一旦失守，后面所有护栏都在拿垃圾做判断。
 *
 * 这套契约是**两层**的（实施文档 Part 1.2 三个必须知道的点之一）：
 *   · AgentOutput      —— 严格版：字段必填、枚举封闭、数值有界。用来生成给模型的 JSON Schema。
 *   · AgentOutputLoose —— 宽容版：只对 rules_hit / confidence 兜底，其余一样严。解析路径用它。
 * 所以「越界的 confidence 抛不抛错」取决于你问的是哪一层 —— 下面的用例把这件事钉死。
 */

const VALID = {
  customer_intent: '询价',
  lead_stage: 'INTERESTED',
  next_action: '回答问题',
  reply: '稍等，我确认一下再回你',
  reason: '客户问了价格，属于已表达具体兴趣',
  need_human: false,
  rules_hit: ['R1'],
  confidence: 0.82,
}

describe('正常输入', () => {
  it('合法 JSON 直接通过', () => {
    const parsed = parseAgentOutput(JSON.stringify(VALID))
    expect(parsed.lead_stage).toBe('INTERESTED')
    expect(parsed.rules_hit).toEqual(['R1'])
  })

  it('被 ```json 代码块包起来也能剥出来', () => {
    const raw = ['这是你要的 JSON：', '```json', JSON.stringify(VALID), '```'].join('\n')
    expect(parseAgentOutput(raw).customer_intent).toBe('询价')
  })

  it('前后夹带解释文字也能剥出来', () => {
    const raw = `好的没问题，结果如下：${JSON.stringify(VALID)} 以上。`
    expect(parseAgentOutput(raw).lead_stage).toBe('INTERESTED')
  })
})

describe('脏数据必须被拒绝', () => {
  it('缺 lead_stage → 抛错', () => {
    const { lead_stage, ...rest } = VALID
    expect(lead_stage).toBe('INTERESTED') // 提示：这里只是解构掉，别让 lint 以为它没被用
    expect(() => parseAgentOutput(JSON.stringify(rest))).toThrow()
  })

  it('lead_stage 是枚举外的值 → 抛错', () => {
    expect(() => parseAgentOutput(JSON.stringify({ ...VALID, lead_stage: 'VIP' }))).toThrow()
  })

  it('customer_intent 是模型自创的分类 → 抛错', () => {
    expect(() =>
      parseAgentOutput(JSON.stringify({ ...VALID, customer_intent: '想买又不想买' })),
    ).toThrow()
  })

  it('need_human 给了字符串而不是布尔 → 抛错', () => {
    expect(() => parseAgentOutput(JSON.stringify({ ...VALID, need_human: 'true' }))).toThrow()
  })

  it('reply 是空字符串 → 抛错（销售没法发一句空的）', () => {
    expect(() => parseAgentOutput(JSON.stringify({ ...VALID, reply: '' }))).toThrow()
  })

  it('完全没有 JSON 对象 → 抛 no_json_object_found', () => {
    expect(() => parseAgentOutput('当然可以！这是你要的结果：😀')).toThrow(/no_json_object_found/)
  })
})

describe('宽容层刻意容忍的两类脏数据（不让一条脏字段毁掉整次判定）', () => {
  it('少了 rules_hit → 兜成空数组', () => {
    const { rules_hit, ...rest } = VALID
    expect(rules_hit).toEqual(['R1'])
    expect(parseAgentOutput(JSON.stringify(rest)).rules_hit).toEqual([])
  })

  it('rules_hit 不是数组 → 也兜成空数组', () => {
    expect(parseAgentOutput(JSON.stringify({ ...VALID, rules_hit: 'R1' })).rules_hit).toEqual([])
  })

  it('少了 confidence → 兜成 0.5（不是 1，也不崩）', () => {
    const { confidence, ...rest } = VALID
    expect(confidence).toBe(0.82)
    expect(parseAgentOutput(JSON.stringify(rest)).confidence).toBe(0.5)
  })

  it('confidence 越界（88）→ 兜成 0.5，而不是抛错', () => {
    expect(parseAgentOutput(JSON.stringify({ ...VALID, confidence: 88 })).confidence).toBe(0.5)
  })

  it('少了 human_trigger（G7 的自报条件）→ 兜成空字符串', () => {
    const parsed = parseAgentOutput(JSON.stringify(VALID))
    expect(parsed.human_trigger).toBe('')
  })

  it('human_trigger 是模型报的条件 → 原样保留（是否放行由护栏判定）', () => {
    const parsed = parseAgentOutput(JSON.stringify({ ...VALID, human_trigger: '投诉' }))
    expect(parsed.human_trigger).toBe('投诉')
  })

  it('多出来的字段被丢掉，不会流进业务', () => {
    const parsed = parseAgentOutput(JSON.stringify({ ...VALID, 建议: '再送一节课' }))
    expect(parsed).not.toHaveProperty('建议')
  })
})

describe('严格契约与宽容层的分工', () => {
  it('严格版 AgentOutput 会拒绝越界 confidence（宽容只用在解析路径）', () => {
    expect(() => AgentOutput.parse({ ...VALID, human_trigger: '', confidence: 88 })).toThrow()
  })

  it('严格版要求 human_trigger 必填 —— 宽容层才给它兜空字符串', () => {
    expect(() => AgentOutput.parse(VALID)).toThrow() // VALID 里没有 human_trigger
    expect(() => AgentOutput.parse({ ...VALID, human_trigger: '' })).not.toThrow()
  })

  it('传给模型的契约字段齐全、且全为必填（strict json_schema 的前提）', () => {
    const shape = AgentOutput.shape
    expect(Object.keys(shape).sort()).toEqual(
      [
        'confidence',
        'customer_intent',
        'human_trigger',
        'lead_stage',
        'need_human',
        'next_action',
        'reason',
        'reply',
        'rules_hit',
      ].sort(),
    )
    // 契约里不能有 .default()：strict json_schema 要求所有字段 required
    for (const key of Object.keys(shape)) {
      expect(shape[key as keyof typeof shape].isOptional()).toBe(false)
    }
  })
})
