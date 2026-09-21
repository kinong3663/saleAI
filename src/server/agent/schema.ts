import { z } from 'zod'
import { CUSTOMER_INTENTS, LEAD_STAGES, NEXT_ACTIONS } from '@/lib/constants'

//
// 结构化输出的唯一真源。同一份定义同时用于：
// ① 生成发给模型的 JSON Schema ② 校验模型返回 ③ 生成 TS 类型
//
// 注意：strict 模式下所有字段都必须 required、且 additionalProperties=false，
// 所以这里 **不能用 .default()** —— 默认值会让 strict 校验失败。
// 缺省值的兜底放在下面的 Loose 版本里。
//
export const AgentOutput = z.object({
  customer_intent: z.enum(CUSTOMER_INTENTS),
  lead_stage: z.enum(LEAD_STAGES),
  next_action: z.enum(NEXT_ACTIONS),
  reply: z.string().min(1).max(500),
  reason: z.string().min(1).max(500),
  need_human: z.boolean(),
  // 命中的转人工条件（原样抄写租户配置里的那条情形文字；没命中填空字符串）。
  // 语义判断交给模型，能不能转人工由租户配置说了算 —— 校验在 guardrails 的 G7。
  human_trigger: z.string(),
  rules_hit: z.array(z.string()),
  confidence: z.number().min(0).max(1),
})
export type AgentOutput = z.infer<typeof AgentOutput>

//
// 宽容解析：删掉长度约束（部分模型对 maxLength/minLength 支持不好），
// 并允许 rules_hit / confidence / human_trigger 缺省。
//
export const AgentOutputLoose = z.object({
  customer_intent: z.enum(CUSTOMER_INTENTS),
  lead_stage: z.enum(LEAD_STAGES),
  next_action: z.enum(NEXT_ACTIONS),
  reply: z.string().min(1),
  reason: z.string().min(1),
  need_human: z.boolean(),
  human_trigger: z.string().catch(''),
  rules_hit: z.array(z.string()).catch([]),
  confidence: z.number().min(0).max(1).catch(0.5),
})
export type AgentOutputLoose = z.infer<typeof AgentOutputLoose>

/** 校验模型返回。绝对不要直接 JSON.parse 后当 AgentOutput 用。 */
export function parseAgentOutput(raw: string): AgentOutputLoose {
  const json = JSON.parse(extractJsonObject(raw)) // 抛错由调用方兜住
  return AgentOutputLoose.parse(json) // 抛 ZodError 由调用方兜住
}

/** 模型有时会在 JSON 外包一层 markdown 代码块或解释文字，这里把它剥掉。 */
function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no_json_object_found')
  return raw.slice(start, end + 1)
}

//
// 发给模型的 JSON Schema（从 Loose 版本生成，去掉部分兼容实现不认的关键字）。
// 用 z.toJSONSchema 而不是手写第二份 —— 手写的那份会和 Zod 契约漂移，
// 而「契约只有一处定义」正是这个文件存在的理由。
//
function stripUnsupportedKeywords(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripUnsupportedKeywords)
  if (typeof node !== 'object' || node === null) return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'default' || key === '$schema') continue
    out[key] = stripUnsupportedKeywords(value)
  }
  return out
}

export const AGENT_OUTPUT_JSON_SCHEMA = stripUnsupportedKeywords(
  z.toJSONSchema(AgentOutputLoose),
) as Record<string, unknown>
