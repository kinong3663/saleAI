import { Prisma } from '@prisma/client'
import { HISTORY_LIMIT, type LeadStage, type Trigger } from '@/lib/constants'
import type { AgentRunDTO } from '@/lib/types'
import { prisma } from '@/server/db'
import { NotFoundError } from '@/server/errors'
import { getCustomerState } from '@/server/services/customer.service'
import { listMessages } from '@/server/services/message.service'
import { applyAnalysisToState, type StateDb } from '@/server/services/state.service'
import { getTenantForAgent } from '@/server/services/tenant.service'
import { buildFallbackOutput } from './fallback'
import {
  applyGuardrails,
  buildCorrectionSuffix,
  type GuardrailContext,
  type GuardrailIssue,
  type GuardrailResult,
} from './guardrails'
import { callLLM, getLlmModel, isStrictUnsupported } from './llm'
import { buildSystemPrompt, buildUserPrompt, type HistoryRow } from './prompt'
import { parseAgentOutput, type AgentOutput, type AgentOutputLoose } from './schema'

/**
 * 唯一的编排入口（决策 Q12）。
 *
 * 一条客户消息进来之后发生了什么：
 *   幂等检查 → 读租户配置 + 客户状态 + 最近 HISTORY_LIMIT 条历史 → 渲染 prompt
 *   → 调 LLM（**不在事务里**）→ Zod 校验（失败则带强约束重试一次）
 *   → 护栏裁决 →（必要时）带约束重生成一次 → 一个事务里落 AgentRun + 更新 CustomerState
 *
 * S7：任何一步拿不到可用输出，都走**降级**而不是抛错 ——
 * 产出一张「AI 暂不可用，已转人工」的卡片，状态不前进，AgentRun.status = FALLBACK。
 *
 * 状态迁移只由 trigger = CUSTOMER_MESSAGE 驱动（决策 Q13），
 * 收紧点在 state.service.applyAnalysisToState 里，不在这个文件。
 */

/** 解析失败后的重试提示（实施文档 S7：非法 JSON / 字段缺失 都重试一次） */
const JSON_REPAIR_SUFFIX = [
  '',
  '## 追加约束（触发于解析失败）',
  '你上一次的回复不是合法 JSON，或者缺少必需字段。',
  '请只输出一个 JSON 对象：不要 markdown 代码块、不要任何解释文字、不要多余字段，',
  '并且必须包含全部字段：customer_intent / lead_stage / next_action / reply / reason / need_human / rules_hit / confidence。',
].join('\n')

export interface AnalyzeInput {
  trigger: Trigger
  triggerMessageId: string | null
}

export interface AnalyzeResult {
  ok: boolean
  reused: boolean
  run: AgentRunDTO
  reason?: string
  /** true = 本次是降级产出（AgentRun.status = FALLBACK） */
  fallback?: boolean
}

export async function analyzeCustomerMessage(
  tenantId: string,
  customerId: string,
  input: AnalyzeInput,
): Promise<AnalyzeResult> {
  // ── 幂等：这条消息判定过就不再调模型 ──
  // 数据库的 @@unique([customerId, triggerMessageId]) 是最后一道防线，这里先查一次是省钱
  if (input.triggerMessageId) {
    const existing = await prisma.agentRun.findFirst({
      where: { customerId, triggerMessageId: input.triggerMessageId },
    })
    if (existing) {
      return {
        ok: existing.status === 'SUCCESS' || existing.status === 'REPAIRED',
        reused: true,
        run: toRunDTO(existing),
      }
    }
  }

  const [tenant, customer] = await Promise.all([
    getTenantForAgent(tenantId),
    getCustomerState(tenantId, customerId),
  ])
  if (!tenant || !customer) throw new NotFoundError('customer_not_found')

  const historyRows = await listMessages(tenantId, customerId, { take: HISTORY_LIMIT })
  const history: HistoryRow[] = historyRows.map((m) => ({
    role: m.role,
    content: m.content,
    createdAt: new Date(m.createdAt),
  }))

  const prevStage = (customer.state?.leadStage ?? 'NEW') as LeadStage
  const prevIntent = customer.state?.intent ?? null
  const system = buildSystemPrompt(tenant, input.trigger)
  const user = buildUserPrompt({
    state: {
      leadStage: prevStage,
      intent: prevIntent,
      needHuman: customer.state?.needHuman ?? false,
      lastActivityAt: customer.state?.lastActivityAt
        ? new Date(customer.state.lastActivityAt)
        : null,
    },
    history,
  })

  const inputDigest = {
    trigger: input.trigger,
    prevStage,
    prevIntent,
    prevNeedHuman: customer.state?.needHuman ?? false,
    historyCount: history.length,
    strictUnsupported: isStrictUnsupported(),
    system,
    user,
  }

  const guardrailContext: GuardrailContext = {
    prevStage,
    trigger: input.trigger,
    rules: tenant.config.rules,
    // 条件判定只看客户说过的话
    historyText: history
      .filter((h) => h.role === 'CUSTOMER')
      .map((h) => h.content)
      .join('\n'),
  }

  // ── 调模型：绝不在数据库事务里（技术栈文档第 9 节） ──
  const llm = await callLLM(system, user)
  let rawOutput: string | null = llm.ok ? llm.raw : null
  let attempt = llm.attempt
  let latencyMs = llm.latencyMs
  let failure: string | null = null
  let parsed: AgentOutputLoose | null = null

  if (llm.ok) {
    const first = parseOrNull(llm.raw)
    parsed = first.value
    failure = first.error
  } else {
    failure = llm.error
  }

  // 非法 JSON / 字段缺失 / 类型错 → 带强约束重试一次
  if (llm.ok && parsed === null) {
    const repair = await callLLM(system + JSON_REPAIR_SUFFIX, user)
    attempt += repair.attempt
    latencyMs += repair.latencyMs
    if (repair.ok) {
      rawOutput = repair.raw
      const second = parseOrNull(repair.raw)
      parsed = second.value
      failure = second.error
    }
    if (parsed === null && !failure) failure = 'invalid_output'
  }

  // ── 拿不到可用输出 → 降级（不抛错、不红屏） ──
  if (parsed === null) {
    const error = failure ?? 'unknown_error'
    const output = buildFallbackOutput({ prevStage, prevIntent, error })
    const at = new Date()
    const run = await saveRun({
      tenantId,
      customerId,
      triggerMessageId: input.triggerMessageId,
      status: 'FALLBACK',
      latencyMs,
      attempt,
      inputDigest,
      rawOutput,
      output,
      rulesHit: [],
      guardrailIssues: [],
      error,
      applyState: (db: StateDb) =>
        applyAnalysisToState(
          tenantId,
          customerId,
          { trigger: input.trigger, output, at, fallback: true },
          db,
        ),
    })
    return { ok: false, reused: false, run, reason: error, fallback: true }
  }

  // ── 护栏：模型输出不是最终结果，护栏之后的才是 ──
  const guard1 = applyGuardrails(parsed, guardrailContext)
  let output: AgentOutputLoose = guard1.output
  let issues: GuardrailIssue[] = guard1.issues
  let status: 'SUCCESS' | 'REPAIRED' = 'SUCCESS'

  if (guard1.needsRegen) {
    // 只重生成一次；第二次仍违规就换租户配置的兜底话术（S4 关键点）
    status = 'REPAIRED'
    const retry = await callLLM(system + buildCorrectionSuffix(tenant.config.rules, issues), user)
    attempt += retry.attempt
    latencyMs += retry.latencyMs

    let second: GuardrailResult | null = null
    if (retry.ok) {
      rawOutput = retry.raw
      const reparsed = parseOrNull(retry.raw).value
      if (reparsed) second = applyGuardrails(reparsed, guardrailContext)
    }

    if (second) {
      output = second.output
      issues = second.issues
      if (second.needsRegen) {
        output.reply = tenant.config.priceFallbackReply
        second.needsRegen = false
      }
    } else {
      output = { ...guard1.output, reply: tenant.config.priceFallbackReply }
    }
  }

  // ── 一个事务：AgentRun + CustomerState（状态只在这里变） ──
  const analyzedAt = new Date()
  const run = await saveRun({
    tenantId,
    customerId,
    triggerMessageId: input.triggerMessageId,
    status,
    latencyMs,
    attempt,
    inputDigest,
    rawOutput,
    output,
    rulesHit: output.rules_hit,
    guardrailIssues: issues,
    error: null,
    applyState: (db: StateDb) =>
      applyAnalysisToState(
        tenantId,
        customerId,
        { trigger: input.trigger, output, at: analyzedAt },
        db,
      ),
  })

  return { ok: true, reused: false, run }
}

/** 客户详情页要展示「最近一次 AI 判定」 */
export async function getLatestAgentRun(
  tenantId: string,
  customerId: string,
): Promise<AgentRunDTO | null> {
  const row = await prisma.agentRun.findFirst({
    where: { tenantId, customerId },
    orderBy: { createdAt: 'desc' },
  })
  return row ? toRunDTO(row) : null
}

/** 状态时间线：用 AgentRun 当历史（没有单独的状态历史表，判定记录本身就是变更记录） */
export async function getRecentAgentRuns(
  tenantId: string,
  customerId: string,
  take = 10,
): Promise<AgentRunDTO[]> {
  const rows = await prisma.agentRun.findMany({
    where: { tenantId, customerId },
    orderBy: { createdAt: 'desc' },
    take,
  })
  return rows.map(toRunDTO)
}

// ───────── 内部 ─────────

type AgentRunRow = Prisma.AgentRunGetPayload<Record<string, never>>

/** 解析失败不抛异常，把原因（截断）带回去 —— 上层决定重试还是降级 */
function parseOrNull(raw: string): { value: AgentOutputLoose | null; error: string | null } {
  try {
    return { value: parseAgentOutput(raw), error: null }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { value: null, error: `invalid_output: ${message.slice(0, 200)}` }
  }
}

interface SaveRunInput {
  tenantId: string
  customerId: string
  triggerMessageId: string | null
  status: string
  latencyMs: number
  attempt: number
  inputDigest: Prisma.InputJsonValue
  rawOutput: string | null
  output: AgentOutputLoose | null
  rulesHit: string[]
  guardrailIssues: string[]
  error: string | null
  /** 与 AgentRun 同事务执行的状态更新 */
  applyState?: (db: StateDb) => Promise<void>
}

async function saveRun(input: SaveRunInput): Promise<AgentRunDTO> {
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.agentRun.create({
        data: {
          tenantId: input.tenantId,
          customerId: input.customerId,
          triggerMessageId: input.triggerMessageId,
          status: input.status,
          model: getLlmModel(),
          latencyMs: input.latencyMs,
          attempt: input.attempt,
          inputDigest: input.inputDigest,
          rawOutput: input.rawOutput,
          output:
            input.output === null
              ? Prisma.JsonNull
              : (input.output as unknown as Prisma.InputJsonValue),
          rulesHit: input.rulesHit.join(','),
          guardrailIssues: input.guardrailIssues.join(','),
          error: input.error,
        },
      })
      if (input.applyState) await input.applyState(tx)
      return created
    })
    return toRunDTO(row)
  } catch (e) {
    // 并发下同一条消息可能被判定两次：唯一约束说了算，读回已存在的那条
    // （事务已回滚，所以这次不会重复改状态）
    const duplicated =
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002' &&
      input.triggerMessageId !== null
    if (duplicated) {
      const existing = await prisma.agentRun.findFirst({
        where: { customerId: input.customerId, triggerMessageId: input.triggerMessageId },
      })
      if (existing) return toRunDTO(existing)
    }
    throw e
  }
}

function toRunDTO(row: AgentRunRow): AgentRunDTO {
  return {
    id: row.id,
    status: row.status,
    model: row.model,
    latencyMs: row.latencyMs,
    attempt: row.attempt,
    triggerMessageId: row.triggerMessageId,
    output: (row.output ?? null) as AgentOutput | null,
    rawOutput: row.rawOutput,
    rulesHit: splitList(row.rulesHit),
    guardrailIssues: splitList(row.guardrailIssues),
    error: row.error,
    suggestionSent: row.suggestionSent,
    suggestionEdited: row.suggestionEdited,
    createdAt: row.createdAt.toISOString(),
  }
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}
